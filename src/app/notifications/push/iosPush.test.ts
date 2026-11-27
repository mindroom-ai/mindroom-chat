import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import * as CapacitorCore from '@capacitor/core';
const { Capacitor } = CapacitorCore;
import { PushNotifications } from '@capacitor/push-notifications';
import {
  buildIOSPushPusherRequest,
  clearIOSPushState,
  disableIOSPushPusher,
  findIOSPushAccount,
  getAllowedNativeNotificationAccountTags,
  getIOSPushEnabled,
  getStoredIOSPushToken,
  isNativeAndroidPushConfigured,
  isNativeAndroidPushPlatform,
  isNativePushPlatform,
  resetNativeAndroidPushConfiguredCache,
  migrateLegacyIOSPushEnabled,
  reconcileIOSPushNativeState,
  resolveEffectiveIOSPushFormat,
  resolveIOSPushConfig,
  resolveNativePushConfig,
  setIOSPushEnabled,
  upsertIOSPushPusher,
} from './iosPush';
import type { ClientConfig } from '../../config/useClientConfig';
import { cloudflareAccessAllowsPush, hasCloudflareAccess } from '../../native/cloudflareAccess';
import { SESSION_STORE_KEY } from '../../matrix/session/sessions';

import {
  isNativeNotificationsAvailable,
  reconcileNativeNotificationAccounts,
} from '../../native/nativeNotifications';

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: { checkPermissions: vi.fn(async () => ({ receive: 'granted' })) },
}));
vi.mock('../../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: vi.fn(() => true),
  hasCloudflareAccess: vi.fn(() => false),
}));
// No notification extension, as in a browser, unless a test says otherwise.
vi.mock('../../native/nativeNotifications', () => ({
  isNativeNotificationsAvailable: vi.fn(() => false),
  reconcileNativeNotificationAccounts: vi.fn(async () => undefined),
}));

describe('resolveIOSPushConfig', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }
  });

  it('returns undefined when iOS push is disabled', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: false,
            appId: 'com.mindroom-ios',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          },
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when required fields are missing', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: true,
            appId: '',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          },
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when gatewayUrl is invalid', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: true,
            appId: 'com.mindroom-ios',
            gatewayUrl: 'not-a-url',
          },
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when gatewayUrl is not https', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: true,
            appId: 'com.mindroom-ios',
            gatewayUrl: 'http://push.example.com/_matrix/push/v1/notify',
          },
        },
      })
    ).toBeUndefined();
  });

  it('normalizes optional values and uses defaults', () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
      configurable: true,
    });

    const config = resolveIOSPushConfig({
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          appDisplayName: '',
          deviceDisplayName: '',
          format: 'event_id_only',
          append: true,
          lang: 'en',
        },
      },
    });

    expect(config).toBeDefined();
    expect(config?.appId).toBe('com.mindroom-ios');
    expect(config?.gatewayUrl).toBe('https://push.example.com/_matrix/push/v1/notify');
    expect(config?.appDisplayName).toBe('MindRoom iOS');
    expect(config?.deviceDisplayName).toBe('MindRoom iOS');
    expect(config?.format).toBe('event_id_only');
    expect(config?.append).toBe(true);
    expect(config?.profileTag).toEqual(expect.any(String));
    expect(config?.profileTag?.length).toBeGreaterThan(0);
  });

  it('uses event-id-only as the privacy-preserving fallback when format is omitted', () => {
    const config = resolveIOSPushConfig({
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        },
      },
    });

    expect(config?.format).toBe('event_id_only');
  });

  it('uses the app language unless deployment config explicitly overrides it', () => {
    const baseConfig = {
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        },
      },
    };

    expect(resolveIOSPushConfig(baseConfig, undefined, 'de')?.lang).toBe('de');
    expect(
      resolveIOSPushConfig(
        {
          push: { ios: { ...baseConfig.push.ios, lang: 'en-GB' } },
        },
        undefined,
        'de'
      )?.lang
    ).toBe('en-GB');
  });

  it('keeps push tokens and enabled state separate per session', async () => {
    const storage = new Map<string, string>();
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
      value: {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    const mx = {
      setPusher: async () => undefined,
      getHomeserverUrl: () => 'https://matrix.example',
    } as unknown as MatrixClient;
    const pushConfig = {
      appId: 'com.mindroom-ios',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'MindRoom iOS',
      deviceDisplayName: 'iPhone',
      profileTag: 'profile-1',
      append: true,
      format: 'event_id_only' as const,
      lang: 'en',
    };

    await upsertIOSPushPusher(mx, pushConfig, 'token-a', 'session-a');
    await upsertIOSPushPusher(mx, pushConfig, 'token-b', 'session-b');
    setIOSPushEnabled(false, 'session-a');

    expect(getStoredIOSPushToken('session-a')).toBe('token-a');
    expect(getStoredIOSPushToken('session-b')).toBe('token-b');
    expect(getIOSPushEnabled('session-a')).toBe(false);
    expect(getIOSPushEnabled('session-b')).toBe(true);
  });

  it('migrates the legacy preference before a generic settings write drops it', async () => {
    const storage = new Map<string, string>([
      ['settings', JSON.stringify({ nativePushNotifications: false })],
    ]);
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
      value: {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    migrateLegacyIOSPushEnabled();
    const { getSettings, setSettings } = await import('../../preferences/settings');
    setSettings({ ...getSettings(), pageZoom: 90 });

    expect(JSON.parse(storage.get('settings') ?? '{}')).not.toHaveProperty(
      'nativePushNotifications'
    );
    expect(storage.get('mindroom_ios_push_enabled')).toBe('0');
    expect(getIOSPushEnabled('session-a')).toBe(false);
    expect(getIOSPushEnabled('session-b')).toBe(false);

    setIOSPushEnabled(true, 'session-a');

    expect(getIOSPushEnabled('session-a')).toBe(true);
    expect(getIOSPushEnabled('session-b')).toBe(false);
  });

  it('does not overwrite an existing migrated global push preference', () => {
    const storage = new Map<string, string>([
      ['settings', JSON.stringify({ nativePushNotifications: false })],
      ['mindroom_ios_push_enabled', '1'],
    ]);
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
      value: {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    migrateLegacyIOSPushEnabled();

    expect(storage.get('mindroom_ios_push_enabled')).toBe('1');
    expect(getIOSPushEnabled('session-a')).toBe(true);
  });

  it('attempts every push-state removal when one key is blocked', async () => {
    const storage = new Map<string, string>([
      ['mindroom_ios_push_token::session-a', 'token'],
      ['mindroom_ios_push_profile_tag::session-a', 'profile'],
      ['mindroom_ios_push_enabled::session-a', '1'],
    ]);
    const removeItem = vi.fn((key: string) => {
      if (key.includes('profile_tag')) throw new Error('blocked');
      storage.delete(key);
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: { removeItem },
        dispatchEvent: () => true,
      },
      configurable: true,
    });

    await expect(clearIOSPushState('session-a')).resolves.toBeUndefined();
    expect(removeItem).toHaveBeenCalledTimes(3);
    expect(storage.has('mindroom_ios_push_token::session-a')).toBe(false);
    expect(storage.has('mindroom_ios_push_enabled::session-a')).toBe(false);
    expect(storage.has('mindroom_ios_push_profile_tag::session-a')).toBe(true);
  });

  describe('what the accounts share with the notification extension', () => {
    const fullPushes: ClientConfig = {
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          format: 'full',
        },
      },
    };
    const accountA = {
      sessionId: 'session-a',
      baseUrl: 'https://a.example',
      userId: '@a:a.example',
    };
    const accountB = {
      sessionId: 'session-b',
      baseUrl: 'https://b.example',
      userId: '@b:b.example',
    };

    /** A device with the accounts signed in, account A used last, and `entries` in its storage. */
    const stubDevice = (
      signedIn: (typeof accountA)[],
      entries: [string, string][] = [
        ['mindroom_ios_push_profile_tag::session-a', 'tag-a'],
        ['mindroom_ios_push_profile_tag::session-b', 'tag-b'],
      ]
    ) => {
      const storage = new Map<string, string>([
        [
          SESSION_STORE_KEY,
          JSON.stringify({
            version: 1,
            sessions: signedIn.map((session, index) => ({
              ...session,
              deviceId: 'D',
              accessToken: 't',
              lastUsedAt: signedIn.length - index,
            })),
            activeSessionId: signedIn[0]?.sessionId,
          }),
        ],
        ...entries,
      ]);
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
      return storage;
    };
    /** The account lists the app was asked to keep, in the order it was asked. */
    const reconciled = () =>
      vi.mocked(reconcileNativeNotificationAccounts).mock.calls.map(([allowed]) => allowed);

    beforeEach(() => {
      vi.mocked(isNativeNotificationsAvailable).mockReturnValue(true);
      vi.mocked(reconcileNativeNotificationAccounts).mockReset();
      vi.mocked(reconcileNativeNotificationAccounts).mockResolvedValue(undefined);
      vi.mocked(PushNotifications.checkPermissions).mockReset();
      vi.mocked(PushNotifications.checkPermissions).mockResolvedValue({ receive: 'granted' });
    });

    afterEach(() => {
      vi.mocked(isNativeNotificationsAvailable).mockReturnValue(false);
      vi.mocked(hasCloudflareAccess).mockReturnValue(false);
      vi.mocked(cloudflareAccessAllowsPush).mockReturnValue(true);
    });

    describe('getAllowedNativeNotificationAccountTags', () => {
      it('lists the stored tag of every signed-in account whose push is on', () => {
        stubDevice([accountA, accountB]);
        expect(getAllowedNativeNotificationAccountTags()).toEqual(['tag-a', 'tag-b']);

        setIOSPushEnabled(false, 'session-a');
        expect(getAllowedNativeNotificationAccountTags()).toEqual(['tag-b']);
      });

      it('leaves out a signed-out account, and makes no tag for an account without one', () => {
        // Account B has signed out: its tag is still stored, as after a sign-out that was cut off.
        const storage = stubDevice(
          [accountA],
          [['mindroom_ios_push_profile_tag::session-b', 'tag-b']]
        );

        expect(getAllowedNativeNotificationAccountTags()).toEqual([]);
        expect(getAllowedNativeNotificationAccountTags(fullPushes)).toEqual([]);
        expect(storage.has('mindroom_ios_push_profile_tag::session-a')).toBe(false);
      });

      it('leaves out an account whose server keeps pushes off', () => {
        stubDevice([accountA, accountB]);
        vi.mocked(cloudflareAccessAllowsPush).mockImplementation(
          (baseUrl) => baseUrl !== 'https://a.example'
        );

        expect(getAllowedNativeNotificationAccountTags()).toEqual(['tag-b']);
        expect(getAllowedNativeNotificationAccountTags(fullPushes)).toEqual(['tag-b']);
      });

      it('given the configuration, lists only the accounts whose pushes name their sender', () => {
        stubDevice([accountA, accountB]);
        expect(getAllowedNativeNotificationAccountTags(fullPushes)).toEqual(['tag-a', 'tag-b']);

        // A server behind Cloudflare Access gets event_id_only pushes whatever is configured.
        vi.mocked(hasCloudflareAccess).mockImplementation(
          (baseUrl) => baseUrl === 'https://b.example'
        );
        expect(getAllowedNativeNotificationAccountTags(fullPushes)).toEqual(['tag-a']);
        // Without the configuration that is left to a caller that has it.
        expect(getAllowedNativeNotificationAccountTags()).toEqual(['tag-a', 'tag-b']);
        vi.mocked(hasCloudflareAccess).mockReturnValue(false);

        const ios = fullPushes.push?.ios;
        expect(
          getAllowedNativeNotificationAccountTags({
            push: { ios: { ...ios, format: 'event_id_only' } },
          })
        ).toEqual([]);
        expect(
          getAllowedNativeNotificationAccountTags({ push: { ios: { ...ios, enabled: false } } })
        ).toEqual([]);
        expect(getAllowedNativeNotificationAccountTags({})).toEqual([]);
      });
    });

    describe('reconcileIOSPushNativeState', () => {
      it('does nothing where the app has no notification extension, as on the Mac and in a browser', async () => {
        stubDevice([accountA, accountB]);
        vi.mocked(isNativeNotificationsAvailable).mockReturnValue(false);

        await reconcileIOSPushNativeState();
        await reconcileIOSPushNativeState({ clientConfig: fullPushes, permission: 'granted' });

        expect(reconcileNativeNotificationAccounts).not.toHaveBeenCalled();
        expect(PushNotifications.checkPermissions).not.toHaveBeenCalled();
      });

      it('keeps no account while signed out, without asking iOS for the permission', async () => {
        // What the last account shared is still to be removed, as after a sign-out that was cut off.
        stubDevice([], [['mindroom_ios_push_profile_tag::session-a', 'tag-a']]);

        await reconcileIOSPushNativeState();

        expect(reconciled()).toEqual([[]]);
        expect(PushNotifications.checkPermissions).not.toHaveBeenCalled();
      });

      it('keeps every signed-in account whose push is on, also the ones that are not active', async () => {
        stubDevice([accountA, accountB]);

        await reconcileIOSPushNativeState();

        expect(reconciled()).toEqual([['tag-a', 'tag-b']]);
        expect(PushNotifications.checkPermissions).toHaveBeenCalledTimes(1);
      });

      it('follows an account whose push is turned off, on again, and off again', async () => {
        stubDevice([accountA, accountB]);

        setIOSPushEnabled(false, 'session-a');
        await reconcileIOSPushNativeState();
        setIOSPushEnabled(true, 'session-a');
        await reconcileIOSPushNativeState();
        setIOSPushEnabled(false, 'session-a');
        await reconcileIOSPushNativeState();

        // The other account keeps what it shares throughout.
        expect(reconciled()).toEqual([['tag-b'], ['tag-a', 'tag-b'], ['tag-b']]);
      });

      it.each(['denied', 'prompt'] as const)(
        'keeps no account while the permission of iOS is %s, which holds for the whole app',
        async (receive) => {
          stubDevice([accountA, accountB]);
          vi.mocked(PushNotifications.checkPermissions).mockResolvedValue({ receive });

          await reconcileIOSPushNativeState({ clientConfig: fullPushes });

          expect(reconciled()).toEqual([[]]);
        }
      );

      it('takes the permission from a caller that knows it', async () => {
        stubDevice([accountA, accountB]);
        vi.mocked(PushNotifications.checkPermissions).mockResolvedValue({ receive: 'denied' });

        await reconcileIOSPushNativeState({ permission: 'granted' });
        await reconcileIOSPushNativeState({ permission: 'denied' });

        expect(reconciled()).toEqual([['tag-a', 'tag-b'], []]);
        expect(PushNotifications.checkPermissions).not.toHaveBeenCalled();
      });

      it('given the configuration, keeps no account behind Cloudflare Access', async () => {
        stubDevice([accountA, accountB]);
        vi.mocked(hasCloudflareAccess).mockImplementation(
          (baseUrl) => baseUrl === 'https://a.example'
        );

        await reconcileIOSPushNativeState({ clientConfig: fullPushes });
        // Nor one whose server's Access policy keeps pushes off.
        vi.mocked(cloudflareAccessAllowsPush).mockReturnValue(false);
        await reconcileIOSPushNativeState({ clientConfig: fullPushes });

        expect(reconciled()).toEqual([['tag-b'], []]);
      });

      it('never rejects: what the app or iOS refuses is tried again by the next call', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        stubDevice([accountA, accountB]);
        vi.mocked(reconcileNativeNotificationAccounts).mockRejectedValueOnce(
          new Error('INTENTS_ERROR')
        );
        await expect(reconcileIOSPushNativeState()).resolves.toBeUndefined();

        vi.mocked(PushNotifications.checkPermissions).mockRejectedValueOnce(new Error('no answer'));
        await expect(reconcileIOSPushNativeState()).resolves.toBeUndefined();
        // Nothing is removed on a guess of the permission.
        expect(reconciled()).toEqual([['tag-a', 'tag-b']]);
        expect(warn).toHaveBeenCalledTimes(2);

        await reconcileIOSPushNativeState();
        expect(reconciled()).toEqual([
          ['tag-a', 'tag-b'],
          ['tag-a', 'tag-b'],
        ]);
        warn.mockRestore();
      });

      it('writes nothing down for a removal that is still owed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const storage = stubDevice([accountA]);
        const before = [...storage.keys()];
        vi.mocked(reconcileNativeNotificationAccounts).mockRejectedValue(
          new Error('INTENTS_ERROR')
        );

        await reconcileIOSPushNativeState();

        expect([...storage.keys()]).toEqual(before);
        warn.mockRestore();
      });
    });

    describe('clearIOSPushState', () => {
      it('removes the account from what the app shares once its stored tag is gone', async () => {
        const storage = stubDevice(
          [accountA, accountB],
          [
            ['mindroom_ios_push_token::session-b', 'token-b'],
            ['mindroom_ios_push_profile_tag::session-b', 'tag-b'],
            ['mindroom_ios_push_enabled::session-b', '1'],
            ['mindroom_ios_push_profile_tag::session-a', 'tag-a'],
          ]
        );
        let storedTagAtCall: string | undefined;
        vi.mocked(reconcileNativeNotificationAccounts).mockImplementationOnce(async () => {
          storedTagAtCall = storage.get('mindroom_ios_push_profile_tag::session-b');
        });

        await clearIOSPushState('session-b');

        // Asked for after the stored tag went: the app keeps the other account only.
        expect(reconciled()).toEqual([['tag-a']]);
        expect(storedTagAtCall).toBeUndefined();
        expect([...storage.keys()].filter((key) => key.includes('session-b'))).toEqual([]);
      });

      it('keeps no account once the last one has signed out', async () => {
        // The sign-out has taken the account out of the registry already.
        stubDevice([], [['mindroom_ios_push_profile_tag::session-a', 'tag-a']]);

        await clearIOSPushState('session-a');

        expect(reconciled()).toEqual([[]]);
      });

      it('resolves only once the app has answered, and also when the app refuses', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        stubDevice([accountA]);
        let answer: () => void = () => undefined;
        vi.mocked(reconcileNativeNotificationAccounts).mockReturnValueOnce(
          new Promise<void>((resolve) => {
            answer = resolve;
          })
        );

        let cleared = false;
        const clearing = clearIOSPushState('session-a').then(() => {
          cleared = true;
        });
        await vi.waitFor(() =>
          expect(reconcileNativeNotificationAccounts).toHaveBeenCalledTimes(1)
        );
        expect(cleared).toBe(false);

        answer();
        await clearing;
        expect(cleared).toBe(true);

        // A sign-out goes on all the same; the next reconcile removes what is left.
        vi.mocked(reconcileNativeNotificationAccounts).mockRejectedValueOnce(
          new Error('INTENTS_ERROR')
        );
        await expect(clearIOSPushState('session-a')).resolves.toBeUndefined();
        warn.mockRestore();
      });
    });
  });
});

describe('resolveEffectiveIOSPushFormat', () => {
  afterEach(() => {
    vi.mocked(hasCloudflareAccess).mockReturnValue(false);
  });

  it('keeps the configured format, except behind Cloudflare Access', () => {
    expect(resolveEffectiveIOSPushFormat({ format: 'full' }, 'https://matrix.example')).toBe(
      'full'
    );
    expect(resolveEffectiveIOSPushFormat({ format: 'event_id_only' }, undefined)).toBe(
      'event_id_only'
    );
    expect(resolveEffectiveIOSPushFormat({ format: 'full' }, undefined)).toBe('full');

    vi.mocked(hasCloudflareAccess).mockReturnValue(true);
    expect(resolveEffectiveIOSPushFormat({ format: 'full' }, 'https://private.example')).toBe(
      'event_id_only'
    );
  });
});

describe('buildIOSPushPusherRequest', () => {
  it('builds a visible fallback for event-id-only pushes', () => {
    const request = buildIOSPushPusherRequest(
      'token-123',
      {
        appId: 'com.mindroom-ios',
        gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        appDisplayName: 'MindRoom iOS',
        deviceDisplayName: 'iPhone',
        profileTag: 'profile-1',
        append: true,
        format: 'event_id_only',
        lang: 'en',
      },
      'account-tag'
    );

    expect(request).toEqual({
      kind: 'http',
      app_id: 'com.mindroom-ios',
      pushkey: 'token-123',
      app_display_name: 'MindRoom iOS',
      device_display_name: 'iPhone',
      profile_tag: 'profile-1',
      append: true,
      lang: 'en',
      data: {
        url: 'https://push.example.com/_matrix/push/v1/notify',
        format: 'event_id_only',
        default_payload: {
          mindroom_account: 'account-tag',
          aps: {
            alert: {
              title: 'MindRoom iOS',
              body: 'New message',
            },
            sound: 'default',
            category: 'MINDROOM_EVENT',
          },
        },
      },
    });
  });

  it('leaves the full-format alert to Sygnal for sender and message previews', () => {
    const request = buildIOSPushPusherRequest(
      'token-123',
      {
        appId: 'com.mindroom-ios',
        gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        appDisplayName: 'MindRoom iOS',
        deviceDisplayName: 'iPhone',
        profileTag: 'profile-1',
        append: true,
        format: 'full',
        lang: 'en',
      },
      'account-tag'
    );

    expect(request.data).toEqual({
      url: 'https://push.example.com/_matrix/push/v1/notify',
      format: 'full',
      default_payload: {
        mindroom_account: 'account-tag',
        aps: {
          sound: 'default',
          category: 'MINDROOM_EVENT',
        },
      },
    });
  });
});

describe('upsertIOSPushPusher', () => {
  it("writes an account's pushers in order: off during a registration removes it, on again keeps it", async () => {
    const storage = new Map<string, string>();
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
    const pending: (() => void)[] = [];
    const requests: unknown[] = [];
    const mx = {
      getHomeserverUrl: () => 'https://matrix.example',
      setPusher: vi.fn(
        (request: unknown) =>
          new Promise<Record<string, never>>((resolve) => {
            pending.push(() => {
              requests.push(request);
              resolve({});
            });
          })
      ),
    };
    const pushConfig = {
      appId: 'chat.example',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'Chat',
      deviceDisplayName: 'iPhone',
      profileTag: 'profile-1',
      append: true,
      format: 'full' as const,
      lang: 'en',
    };
    const settle = async () => {
      for (let round = 0; round < 10; round += 1) {
        pending.shift()?.();
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    };

    // The registration is still sending when push goes off, then on again.
    const first = upsertIOSPushPusher(mx, pushConfig, 'apns-token', 'session-a');
    const off = disableIOSPushPusher(mx, pushConfig, 'session-a');
    const again = upsertIOSPushPusher(mx, pushConfig, 'apns-token', 'session-a');
    await settle();
    await Promise.all([first, off, again]);

    expect(requests.map((request) => (request as { kind: unknown }).kind)).toEqual([
      'http',
      null,
      'http',
    ]);
    expect(getStoredIOSPushToken('session-a')).toBe('apns-token');
  });

  it("tags the pushes with the account's own random tag, whatever profile tag is configured", async () => {
    const storage = new Map<string, string>([
      [
        SESSION_STORE_KEY,
        JSON.stringify({
          version: 1,
          sessions: [
            { sessionId: 'session-a', baseUrl: 'https://a.example', userId: '@a:a.example' },
            { sessionId: 'session-b', baseUrl: 'https://b.example', userId: '@b:b.example' },
          ].map((session) => ({ ...session, deviceId: 'D', accessToken: 't', lastUsedAt: 1 })),
          activeSessionId: 'session-b',
        }),
      ],
    ]);
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
    const mx = { setPusher: vi.fn(), getHomeserverUrl: () => 'https://a.example' };
    const pushConfig = {
      appId: 'chat.example',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'Chat',
      deviceDisplayName: 'iPhone',
      profileTag: 'configured-for-everyone',
      append: true,
      format: 'full' as const,
      lang: 'en',
    };

    await upsertIOSPushPusher(mx, pushConfig, 'apns-token', 'session-a');
    await upsertIOSPushPusher(mx, pushConfig, 'apns-token', 'session-b');

    const tags = mx.setPusher.mock.calls.map(
      ([request]) =>
        (request as { data: { default_payload: Record<string, unknown> } }).data.default_payload
          .mindroom_account
    );
    expect(tags[0]).toEqual(expect.any(String));
    expect(tags[1]).toEqual(expect.any(String));
    expect(tags[0]).not.toBe(tags[1]);
    expect(mx.setPusher.mock.calls[0]?.[0]).toMatchObject({
      profile_tag: 'configured-for-everyone',
    });
    expect(findIOSPushAccount(tags[0] as string)?.sessionId).toBe('session-a');
    expect(findIOSPushAccount(tags[1] as string)?.sessionId).toBe('session-b');
    expect(findIOSPushAccount('unknown')).toBeUndefined();

    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('keeps the configured format for a server without Cloudflare Access', async () => {
    vi.mocked(hasCloudflareAccess).mockReturnValue(false);
    const mx = { setPusher: vi.fn(), getHomeserverUrl: () => 'https://public.example' };

    await upsertIOSPushPusher(
      mx,
      {
        appId: 'chat.example',
        gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        appDisplayName: 'Chat',
        deviceDisplayName: 'iPhone',
        profileTag: 'profile-1',
        append: true,
        format: 'full',
        lang: 'en',
      },
      'apns-token'
    );

    expect(mx.setPusher).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ format: 'full' }) })
    );
  });

  it('registers content-free pushes for a server behind Cloudflare Access', async () => {
    vi.mocked(hasCloudflareAccess).mockImplementation((url) => url === 'https://private.example');
    const mx = { setPusher: vi.fn(), getHomeserverUrl: () => 'https://private.example' };

    await upsertIOSPushPusher(
      mx,
      {
        appId: 'chat.example',
        gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        appDisplayName: 'Chat',
        deviceDisplayName: 'iPhone',
        profileTag: 'profile-1',
        append: true,
        format: 'full',
        lang: 'en',
      },
      'apns-token'
    );

    expect(mx.setPusher).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          format: 'event_id_only',
          default_payload: {
            aps: {
              sound: 'default',
              category: 'MINDROOM_EVENT',
              alert: { title: 'Chat', body: 'New message' },
            },
            mindroom_account: expect.any(String),
          },
        }),
      })
    );
    expect(hasCloudflareAccess).toHaveBeenCalledWith('https://private.example');
  });
});

describe('Android FCM push support', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects native Android as a native push platform while keeping iOS check false', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

    expect(isNativeAndroidPushPlatform()).toBe(true);
    expect(isNativePushPlatform()).toBe(true);
  });

  it('resolves push.android on native Android with Android display name defaults', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

    const config = resolveIOSPushConfig(
      {
        push: {
          ios: {
            enabled: true,
            appId: 'chat.mindroom.app',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          },
          android: {
            enabled: true,
            appId: 'com.mindroom_ai.app',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
            format: 'full',
          },
        },
      },
      undefined,
      'en'
    );

    expect(config).toMatchObject({
      platform: 'android',
      appId: 'com.mindroom_ai.app',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'MindRoom Android',
      deviceDisplayName: 'MindRoom Android',
      format: 'full',
      append: true,
      lang: 'en',
    });
  });

  it('builds Android pusher requests without an iOS aps block', () => {
    const config = resolveNativePushConfig(
      {
        push: {
          android: {
            enabled: true,
            appId: 'com.mindroom_ai.app',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
            profileTag: 'android-tag',
            format: 'event_id_only',
          },
        },
      },
      'android',
      undefined,
      'en'
    );
    expect(config).toBeDefined();

    const request = buildIOSPushPusherRequest('fcm-token-123', config!, 'account-tag');

    expect(request).toEqual({
      kind: 'http',
      app_id: 'com.mindroom_ai.app',
      pushkey: 'fcm-token-123',
      app_display_name: 'MindRoom Android',
      device_display_name: 'MindRoom Android',
      profile_tag: 'android-tag',
      append: true,
      lang: 'en',
      data: {
        url: 'https://push.example.com/_matrix/push/v1/notify',
        format: 'event_id_only',
        default_payload: {
          mindroom_account: 'account-tag',
        },
      },
    });
    expect(request.data.default_payload).not.toHaveProperty('aps');
  });

  it('reports FCM when Android push registration returns an empty token', async () => {
    const mx = { setPusher: vi.fn(), getHomeserverUrl: () => 'https://matrix.example' };
    await expect(
      upsertIOSPushPusher(
        mx,
        {
          platform: 'android',
          appId: 'com.mindroom_ai.app',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          appDisplayName: 'MindRoom Android',
          deviceDisplayName: 'MindRoom Android',
          profileTag: 'profile-1',
          append: true,
          format: 'full',
          lang: 'en',
        },
        '   '
      )
    ).rejects.toThrow('FCM registration returned an empty push token.');
  });

  it('gates Android FCM on MindRoomPushConfig.isConfigured() and caches the result', async () => {
    resetNativeAndroidPushConfiguredCache();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    await expect(isNativeAndroidPushConfigured()).resolves.toBe(true);

    // On Android without the native plugin, report unconfigured.
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.spyOn(Capacitor, 'isPluginAvailable').mockReturnValue(false);
    await expect(isNativeAndroidPushConfigured()).resolves.toBe(false);

    // On Android with MindRoomPushConfig resolving configured: true, cache the result.
    const isConfigured = vi.fn().mockResolvedValue({ configured: true });
    vi.spyOn(Capacitor, 'isPluginAvailable').mockImplementation(
      (name) => name === 'MindRoomPushConfig'
    );
    const registerSpy = vi
      .spyOn(CapacitorCore, 'registerPlugin')
      .mockReturnValue({ isConfigured });
    resetNativeAndroidPushConfiguredCache();
    await expect(isNativeAndroidPushConfigured()).resolves.toBe(true);
    await expect(isNativeAndroidPushConfigured()).resolves.toBe(true);
    expect(isConfigured).toHaveBeenCalledTimes(1);

    // On failure or configured: false, resolve false cleanly.
    resetNativeAndroidPushConfiguredCache();
    isConfigured.mockResolvedValueOnce({ configured: false });
    await expect(isNativeAndroidPushConfigured()).resolves.toBe(false);

    resetNativeAndroidPushConfiguredCache();
    isConfigured.mockRejectedValueOnce(new Error('plugin error'));
    await expect(isNativeAndroidPushConfigured()).resolves.toBe(false);

    registerSpy.mockRestore();
    resetNativeAndroidPushConfiguredCache();
  });
});
