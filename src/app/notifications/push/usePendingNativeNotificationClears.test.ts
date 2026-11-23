import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingNativeNotificationClears } from './usePendingNativeNotificationClears';

const PENDING_KEY = 'mindroom_ios_push_pending_native_clears';
const PENDING_ALL_KEY = 'mindroom_ios_push_pending_native_clear_all';

/** The app, as far as the hook reaches it: what its plugin is asked and how it answers. */
const native = vi.hoisted(() => ({
  available: true,
  // The Keychain or Siri refuses a removal while this is set.
  refuses: false,
  clearAccount: [] as string[],
  clearAllAccounts: 0,
  onAppStateChange: undefined as ((appState: { isActive: boolean }) => void) | undefined,
  listenerRemoved: false,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    isPluginAvailable: () => native.available,
  },
  registerPlugin: () => ({
    clearAccount: async ({ accountTag }: { accountTag: string }) => {
      native.clearAccount.push(accountTag);
      if (native.refuses) throw new Error('KEYCHAIN_ERROR');
    },
    clearAllAccounts: async () => {
      native.clearAllAccounts += 1;
      if (native.refuses) throw new Error('INTENTS_ERROR');
    },
  }),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(
      async (event: string, listener: (appState: { isActive: boolean }) => void) => {
        if (event === 'appStateChange') native.onAppStateChange = listener;
        return {
          remove: async () => {
            native.listenerRemoved = true;
          },
        };
      }
    ),
  },
}));

vi.mock('../../native/cloudflareAccess', () => ({ hasCloudflareAccess: () => false }));

// No Matrix client, no session and no router: as on the sign-in pages.
function SignedOutApp() {
  usePendingNativeNotificationClears();
  return null;
}

const mount = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(SignedOutApp));
  });
  return renderer;
};

const becomeActive = (isActive = true) => act(async () => native.onAppStateChange?.({ isActive }));

describe('usePendingNativeNotificationClears', () => {
  const originalWindow = globalThis.window;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
        dispatchEvent: () => true,
      },
      configurable: true,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    native.available = true;
    native.refuses = false;
    native.clearAccount = [];
    native.clearAllAccounts = 0;
    native.onAppStateChange = undefined;
    native.listenerRemoved = false;
    vi.restoreAllMocks();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    }
  });

  it('makes the clear that a sign-out left owed, signed out, when the app starts', async () => {
    // The sign-out noted the account down and was cut off before the app had removed it.
    storage.set(PENDING_KEY, '["tag-signed-out"]');

    const renderer = await mount();

    expect(native.clearAccount).toEqual(['tag-signed-out']);
    expect(storage.has(PENDING_KEY)).toBe(false);
    renderer.unmount();
  });

  it('tries a refused clear again whenever the app becomes active, and not when it leaves', async () => {
    storage.set(PENDING_KEY, '["tag-a","tag-b"]');
    native.refuses = true;

    const renderer = await mount();
    expect(native.clearAccount).toEqual(['tag-a', 'tag-b']);
    expect(storage.get(PENDING_KEY)).toBe('["tag-a","tag-b"]');

    await becomeActive(false);
    expect(native.clearAccount).toHaveLength(2);

    await becomeActive();
    expect(native.clearAccount).toHaveLength(4);
    expect(storage.get(PENDING_KEY)).toBe('["tag-a","tag-b"]');

    native.refuses = false;
    await becomeActive();
    expect(native.clearAccount).toHaveLength(6);
    expect(storage.has(PENDING_KEY)).toBe(false);

    // Nothing is owed any more.
    await becomeActive();
    expect(native.clearAccount).toHaveLength(6);
    expect(native.clearAllAccounts).toBe(0);
    renderer.unmount();
  });

  it('makes an owed clear of every account first, signed out, and with it the clears it covers', async () => {
    // iOS denied notifications and the app could not remove the accounts; then the user signed out.
    storage.set(PENDING_ALL_KEY, '1');
    storage.set(PENDING_KEY, '["tag-a"]');
    native.refuses = true;

    const renderer = await mount();
    expect(native.clearAllAccounts).toBe(1);
    // Nothing else is tried while it fails.
    expect(native.clearAccount).toEqual([]);
    expect(storage.get(PENDING_ALL_KEY)).toBe('1');
    expect(storage.get(PENDING_KEY)).toBe('["tag-a"]');

    native.refuses = false;
    await becomeActive();
    expect(native.clearAllAccounts).toBe(2);
    expect(native.clearAccount).toEqual([]);
    expect(storage.size).toBe(0);
    renderer.unmount();
  });

  it('stops listening when it unmounts', async () => {
    const renderer = await mount();
    expect(native.onAppStateChange).toBeDefined();

    await act(async () => renderer.unmount());
    expect(native.listenerRemoved).toBe(true);
  });

  it('does nothing where the app has no notification extension', async () => {
    storage.set(PENDING_ALL_KEY, '1');
    storage.set(PENDING_KEY, '["tag-a"]');
    native.available = false;

    const renderer = await mount();

    expect(native.onAppStateChange).toBeUndefined();
    expect(native.clearAccount).toEqual([]);
    expect(native.clearAllAccounts).toBe(0);
    expect(storage.size).toBe(2);
    renderer.unmount();
  });
});
