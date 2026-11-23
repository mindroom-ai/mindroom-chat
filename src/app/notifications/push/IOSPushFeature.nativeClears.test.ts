import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeIOSPushFeature } from './IOSPushFeature';
import { usePendingNativeNotificationClears } from './usePendingNativeNotificationClears';

// The feature and the retry hook with the real push state (iosPush.ts) and the real bridge to
// the app (nativeNotifications.ts); only the app behind the bridge is stood in for.

const PENDING_KEY = 'mindroom_ios_push_pending_native_clears';
const PENDING_ALL_KEY = 'mindroom_ios_push_pending_native_clear_all';

type PushPermission = 'prompt' | 'granted' | 'denied';

const state = vi.hoisted(() => {
  const session: { sessionId: string; accessToken: string } = {
    sessionId: 's1',
    accessToken: 'token-s1',
  };
  const permission: { receive: 'prompt' | 'granted' | 'denied' } = { receive: 'granted' };
  return {
    activeSession: session,
    permission,
    pushEnabled: true,
    appStateListeners: new Set<(appState: { isActive: boolean }) => void>(),
  };
});

/** The app: the accounts it holds for the notification extension, and what it was asked. */
const native = vi.hoisted(() => {
  const accounts = new Map<string, string>();
  const log: string[] = [];
  const control = {
    // The Keychain or Siri refuses a removal of every account while this is set.
    refusesClearAll: false,
    // The next clear of an account waits, as for Siri, until the test lets it end.
    holdNextClear: false,
    endHeldClear: undefined as (() => void) | undefined,
  };
  return {
    accounts,
    log,
    control,
    plugin: {
      syncAccount: async ({ accountTag, userId }: { accountTag: string; userId: string }) => {
        log.push(`sync ${accountTag}`);
        accounts.set(accountTag, userId);
      },
      syncAvatars: async ({ accountTag }: { accountTag: string }) => {
        log.push(`avatars ${accountTag}`);
      },
      clearAccount: async ({ accountTag }: { accountTag: string }) => {
        log.push(`clear ${accountTag} begins`);
        if (control.holdNextClear) {
          control.holdNextClear = false;
          await new Promise<void>((resolve) => {
            control.endHeldClear = resolve;
          });
        }
        // Whatever the app holds of the account when the clear ends goes with it.
        accounts.delete(accountTag);
        log.push(`clear ${accountTag} ends`);
      },
      clearAllAccounts: async () => {
        log.push('clear all');
        if (control.refusesClearAll) throw new Error('INTENTS_ERROR');
        accounts.clear();
      },
    },
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: () => native.plugin,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, listener: (appState: { isActive: boolean }) => void) => {
      if (event === 'appStateChange') state.appStateListeners.add(listener);
      return {
        remove: async () => {
          state.appStateListeners.delete(listener);
        },
      };
    },
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: async () => ({ remove: async () => undefined }),
    checkPermissions: async () => ({ receive: state.permission.receive }),
    register: async () => undefined,
  },
}));

vi.mock('./useIOSPushEnabled', () => ({ useIOSPushEnabled: () => state.pushEnabled }));
vi.mock('../../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => true,
  hasCloudflareAccess: () => false,
  useCloudflareAccessSignInRequired: () => false,
}));
vi.mock('../../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: true }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://private.example',
    getUserId: () => '@me:private.example',
    getAccessToken: () => undefined,
    getRooms: () => [],
    on: () => undefined,
    removeListener: () => undefined,
  }),
}));
vi.mock('../../config/useClientConfig', () => ({
  useClientConfig: () => ({
    push: {
      ios: {
        enabled: true,
        appId: 'chat.example',
        gatewayUrl: 'https://push.example/_matrix/push/v1/notify',
        format: 'full',
      },
    },
  }),
}));
vi.mock('../../matrix/session/useSessionStore', () => ({
  useActiveSession: () => state.activeSession,
}));
vi.mock('../../i18n/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));

// As in the app: the retry hook at its root, the feature under it.
function App() {
  usePendingNativeNotificationClears();
  return React.createElement(NativeIOSPushFeature);
}

const mount = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(App));
  });
  return renderer;
};

const rerender = (renderer: ReactTestRenderer) =>
  act(async () => renderer.update(React.createElement(App)));

const becomeActive = () =>
  act(async () => {
    state.appStateListeners.forEach((listener) => listener({ isActive: true }));
  });

const setPermission = (permission: PushPermission) => {
  state.permission.receive = permission;
};

describe('NativeIOSPushFeature and the clears the app has to confirm', () => {
  const originalWindow = globalThis.window;
  let storage: Map<string, string>;
  const accountTag = (sessionId: string) =>
    storage.get(`mindroom_ios_push_profile_tag::${sessionId}`) ?? '';
  const clearsOfAll = () => native.log.filter((entry) => entry === 'clear all').length;

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
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    state.activeSession = { sessionId: 's1', accessToken: 'token-s1' };
    state.permission.receive = 'granted';
    state.pushEnabled = true;
    state.appStateListeners.clear();
    native.accounts.clear();
    native.log.length = 0;
    native.control.refusesClearAll = false;
    native.control.holdNextClear = false;
    native.control.endHeldClear = undefined;
    vi.restoreAllMocks();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    }
  });

  it('keeps an account whose push is turned on again while its clear is still under way', async () => {
    const renderer = await mount();
    const tag = accountTag('s1');
    expect(tag).not.toBe('');
    expect(native.log).toEqual([`sync ${tag}`, `avatars ${tag}`]);

    // Push is turned off: the app begins the clear and waits for Siri.
    native.control.holdNextClear = true;
    state.pushEnabled = false;
    await rerender(renderer);
    expect(native.log.at(-1)).toBe(`clear ${tag} begins`);
    expect(storage.get(PENDING_KEY)).toBe(JSON.stringify([tag]));

    // Turned on again at once. The app is not asked to store the account before the clear has
    // ended, and the clear is no longer owed: tried again later, it would remove the account.
    state.pushEnabled = true;
    await rerender(renderer);
    expect(native.log.at(-1)).toBe(`clear ${tag} begins`);
    expect(storage.has(PENDING_KEY)).toBe(false);

    await act(async () => native.control.endHeldClear?.());
    expect(native.log.slice(-3)).toEqual([`clear ${tag} ends`, `sync ${tag}`, `avatars ${tag}`]);
    expect(native.accounts.has(tag)).toBe(true);
    expect(storage.has(PENDING_KEY)).toBe(false);

    // Nothing is tried again when the app becomes active.
    await becomeActive();
    expect(native.accounts.has(tag)).toBe(true);
    expect(native.log.filter((entry) => entry.startsWith('clear'))).toHaveLength(2);
    renderer.unmount();
  });

  it('removes both accounts when the app becomes active after a removal that failed, while iOS still denies notifications', async () => {
    // Two accounts on the device, each sharing its own record.
    const renderer = await mount();
    state.activeSession = { sessionId: 's2', accessToken: 'token-s2' };
    await rerender(renderer);
    const tags = [accountTag('s1'), accountTag('s2')];
    expect([...native.accounts.keys()]).toEqual(tags);

    // Notifications are turned off in iOS Settings, and the app cannot remove the accounts.
    setPermission('denied');
    native.control.refusesClearAll = true;
    await becomeActive();
    expect(clearsOfAll()).toBe(1);
    expect(native.accounts.size).toBe(2);
    expect(storage.get(PENDING_ALL_KEY)).toBe('1');

    // The permission stays as it is, so nothing in the feature changes: the removal is tried
    // again because it is owed.
    await becomeActive();
    expect(clearsOfAll()).toBe(2);
    expect(native.accounts.size).toBe(2);
    expect(storage.get(PENDING_ALL_KEY)).toBe('1');

    native.control.refusesClearAll = false;
    await becomeActive();
    expect(clearsOfAll()).toBe(3);
    expect(native.accounts.size).toBe(0);
    expect(storage.has(PENDING_ALL_KEY)).toBe(false);

    await becomeActive();
    expect(clearsOfAll()).toBe(3);
    expect(native.log.some((entry) => entry.startsWith('clear tag'))).toBe(false);
    renderer.unmount();
  });

  it('shares an account again only after the removal of every account that was owed is made', async () => {
    const renderer = await mount();
    state.activeSession = { sessionId: 's2', accessToken: 'token-s2' };
    await rerender(renderer);
    const [tag1, tag2] = [accountTag('s1'), accountTag('s2')];

    setPermission('denied');
    native.control.refusesClearAll = true;
    await becomeActive();
    expect(storage.get(PENDING_ALL_KEY)).toBe('1');

    // Notifications are allowed again while the removal still fails: shared now, the active
    // account would be removed by the removal once it succeeds.
    native.log.length = 0;
    setPermission('granted');
    await becomeActive();
    expect(native.log.filter((entry) => entry !== 'clear all')).toEqual([]);
    expect(storage.get(PENDING_ALL_KEY)).toBe('1');

    // The removal is made: the account that is not active is gone, the active one shared anew.
    native.control.refusesClearAll = false;
    native.log.length = 0;
    await becomeActive();
    expect(storage.has(PENDING_ALL_KEY)).toBe(false);
    expect([...native.accounts.keys()]).toEqual([tag2]);
    expect(native.accounts.has(tag1)).toBe(false);
    expect(native.log.lastIndexOf('clear all')).toBeLessThan(native.log.indexOf(`sync ${tag2}`));
    expect(native.log.at(-1)).toBe(`avatars ${tag2}`);

    // And it stays: nothing is owed that could remove it later.
    native.log.length = 0;
    await becomeActive();
    expect(native.log).toEqual([]);
    expect([...native.accounts.keys()]).toEqual([tag2]);
    renderer.unmount();
  });
});
