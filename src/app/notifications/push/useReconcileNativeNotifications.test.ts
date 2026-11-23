import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STORE_KEY } from '../../matrix/session/sessions';
import { useReconcileNativeNotifications } from './useReconcileNativeNotifications';

// The app side of the plugin, the permission of iOS, and the app's state changes.
const native = vi.hoisted(() => ({
  // False on the Mac app, which registers no MindRoomNotifications plugin.
  available: true,
  // Siri refuses to delete what it keeps of an account while this is set.
  refuses: false,
  permission: 'granted',
  permissionChecks: 0,
  /** The account lists the app was asked to keep, in the order it was asked. */
  reconciled: [] as string[][],
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
    reconcileAccounts: async ({ allowedAccountTags }: { allowedAccountTags: string[] }) => {
      native.reconciled.push(allowedAccountTags);
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

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: async () => {
      native.permissionChecks += 1;
      return { receive: native.permission };
    },
  },
}));

vi.mock('../../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => true,
  hasCloudflareAccess: () => false,
}));

// No Matrix client, no client configuration and no router: as on the sign-in pages.
function AppShell() {
  useReconcileNativeNotifications();
  return null;
}

const mount = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AppShell));
  });
  return renderer;
};

const becomeActive = (isActive = true) => act(async () => native.onAppStateChange?.({ isActive }));

describe('useReconcileNativeNotifications', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  let storage: Map<string, string>;

  /** Signs the accounts in on this device, each with the push tag `tag-<sessionId>`. */
  const signIn = (...sessionIds: string[]) => {
    storage.set(
      SESSION_STORE_KEY,
      JSON.stringify({
        version: 1,
        sessions: sessionIds.map((sessionId, index) => ({
          sessionId,
          baseUrl: 'https://matrix.example',
          userId: `@${sessionId}:matrix.example`,
          deviceId: 'D',
          accessToken: 't',
          lastUsedAt: sessionIds.length - index,
        })),
        activeSessionId: sessionIds[0],
      })
    );
    sessionIds.forEach((sessionId) =>
      storage.set(`mindroom_ios_push_profile_tag::${sessionId}`, `tag-${sessionId}`)
    );
  };
  /** Takes the account out of the registry, as the first step of a sign-out does. */
  const signOutOfRegistry = (...remaining: string[]) => {
    const tags = [...storage].filter(([key]) => key.startsWith('mindroom_ios_push_profile_tag'));
    signIn(...remaining);
    tags.forEach(([key, value]) => storage.set(key, value));
  };

  beforeEach(() => {
    storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: localStorageMock, dispatchEvent: () => true },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    native.available = true;
    native.refuses = false;
    native.permission = 'granted';
    native.permissionChecks = 0;
    native.reconciled = [];
    native.onAppStateChange = undefined;
    native.listenerRemoved = false;
    vi.restoreAllMocks();
    [['window', originalWindow] as const, ['localStorage', originalLocalStorage] as const].forEach(
      ([name, original]) => {
        if (original === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, { value: original, configurable: true });
      }
    );
  });

  it('has the app keep no account while signed out, when the app starts and when it becomes active', async () => {
    const renderer = await mount();
    expect(native.reconciled).toEqual([[]]);

    await becomeActive();
    expect(native.reconciled).toEqual([[], []]);

    // Going to the background removes nothing.
    await becomeActive(false);
    expect(native.reconciled).toEqual([[], []]);
    // Signed out, the permission of iOS does not matter.
    expect(native.permissionChecks).toBe(0);
    renderer.unmount();
  });

  it('removes what a sign-out that was cut off left behind, although nothing was noted down for it', async () => {
    signIn('a', 'b');
    // Account b left the registry, and the page went away before the app was asked anything.
    signOutOfRegistry('a');
    expect(storage.get('mindroom_ios_push_profile_tag::b')).toBe('tag-b');
    const storedBefore = [...storage.keys()];

    const renderer = await mount();

    expect(native.reconciled).toEqual([['tag-a']]);
    // What is owed is read from the accounts themselves: storage is as it was.
    expect([...storage.keys()]).toEqual(storedBefore);
    renderer.unmount();
  });

  it('keeps every signed-in account whose push is on, and follows what changes while the app is away', async () => {
    signIn('a', 'b');
    const renderer = await mount();
    expect(native.reconciled).toEqual([['tag-a', 'tag-b']]);

    // Notifications are turned off in iOS Settings, which holds for every account.
    native.permission = 'denied';
    await becomeActive();
    expect(native.reconciled).toEqual([['tag-a', 'tag-b'], []]);

    native.permission = 'granted';
    storage.set('mindroom_ios_push_enabled::a', '0');
    await becomeActive();
    expect(native.reconciled[2]).toEqual(['tag-b']);
    renderer.unmount();
  });

  it('asks again the next time the app becomes active for what Siri refused to delete', async () => {
    native.refuses = true;
    const renderer = await mount();
    expect(native.reconciled).toEqual([[]]);

    await becomeActive();
    expect(native.reconciled).toEqual([[], []]);

    native.refuses = false;
    await becomeActive();
    expect(native.reconciled).toEqual([[], [], []]);
    renderer.unmount();
  });

  it('does nothing on the Mac app, which has no notification extension', async () => {
    native.available = false;
    signIn('a');

    const renderer = await mount();

    expect(native.reconciled).toEqual([]);
    expect(native.permissionChecks).toBe(0);
    expect(native.onAppStateChange).toBeUndefined();
    renderer.unmount();
  });

  it('stops listening when it goes away', async () => {
    const renderer = await mount();
    expect(native.onAppStateChange).toBeDefined();

    await act(async () => renderer.unmount());

    expect(native.listenerRemoved).toBe(true);
  });
});
