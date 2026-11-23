import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  buildIOSPushPusherRequest,
  clearIOSPushState,
  clearNativeNotificationAccountWithRetry,
  disableIOSPushPusher,
  findIOSPushAccount,
  flushPendingNativeNotificationClears,
  forgetPendingNativeNotificationClear,
  getIOSPushEnabled,
  getStoredIOSPushToken,
  migrateLegacyIOSPushEnabled,
  resolveEffectiveIOSPushFormat,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  upsertIOSPushPusher,
} from './iosPush';
import { hasCloudflareAccess } from '../../native/cloudflareAccess';
import { SESSION_STORE_KEY } from '../../matrix/session/sessions';

import { clearNativeNotificationAccount } from '../../native/nativeNotifications';

vi.mock('../../native/cloudflareAccess', () => ({ hasCloudflareAccess: vi.fn(() => false) }));
vi.mock('../../native/nativeNotifications', () => ({
  clearNativeNotificationAccount: vi.fn(async () => undefined),
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

  it('attempts every push-state removal when one key is blocked', () => {
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

    expect(() => clearIOSPushState('session-a')).not.toThrow();
    expect(removeItem).toHaveBeenCalledTimes(3);
    expect(storage.has('mindroom_ios_push_token::session-a')).toBe(false);
    expect(storage.has('mindroom_ios_push_enabled::session-a')).toBe(false);
    expect(storage.has('mindroom_ios_push_profile_tag::session-a')).toBe(true);
  });

  it('clears native notification credentials and avatar cache using the stored profile tag', async () => {
    vi.mocked(clearNativeNotificationAccount).mockClear();
    const storage = new Map<string, string>([
      ['mindroom_ios_push_token::session-b', 'token-b'],
      ['mindroom_ios_push_profile_tag::session-b', 'tag-b'],
      ['mindroom_ios_push_enabled::session-b', '1'],
    ]);
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          removeItem: (key: string) => storage.delete(key),
        },
        dispatchEvent: () => true,
      },
      configurable: true,
    });

    await clearIOSPushState('session-b');

    expect(clearNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-b');
    expect(storage.size).toBe(0);

    vi.mocked(clearNativeNotificationAccount).mockClear();
    await clearIOSPushState('session-b');
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
  });

  describe('a native clear that the app has to confirm', () => {
    const PENDING_KEY = 'mindroom_ios_push_pending_native_clears';
    const stubStorage = (entries: [string, string][]) => {
      const storage = new Map<string, string>(entries);
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
      return storage;
    };

    it('resolves only once the app has answered, with the tag noted down until then', async () => {
      vi.mocked(clearNativeNotificationAccount).mockClear();
      const storage = stubStorage([['mindroom_ios_push_profile_tag::session-c', 'tag-c']]);
      let answer: () => void = () => undefined;
      let notedAtCall: string | undefined;
      let storedTagAtCall: string | undefined;
      vi.mocked(clearNativeNotificationAccount).mockImplementationOnce(() => {
        notedAtCall = storage.get(PENDING_KEY);
        storedTagAtCall = storage.get('mindroom_ios_push_profile_tag::session-c');
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      });

      let cleared = false;
      const clearing = clearIOSPushState('session-c').then(() => {
        cleared = true;
      });
      await Promise.resolve();
      await Promise.resolve();

      // Noted down before the app is asked, while the stored tag is still there.
      expect(notedAtCall).toBe('["tag-c"]');
      expect(storedTagAtCall).toBe('tag-c');
      expect(cleared).toBe(false);
      // The stored tag is gone at once; what remains names the account for another try.
      expect(storage.has('mindroom_ios_push_profile_tag::session-c')).toBe(false);
      expect(storage.get(PENDING_KEY)).toBe('["tag-c"]');

      answer();
      await clearing;
      expect(cleared).toBe(true);
      expect(storage.size).toBe(0);
    });

    it('keeps the tag of a clear the app refused, and clears it on a later try', async () => {
      vi.mocked(clearNativeNotificationAccount).mockClear();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const storage = stubStorage([
        ['mindroom_ios_push_profile_tag::session-c', 'tag-c'],
        [PENDING_KEY, '["tag-earlier"]'],
      ]);
      // The Keychain kept the record of tag-c; tag-earlier is cleared this time.
      vi.mocked(clearNativeNotificationAccount).mockRejectedValueOnce(new Error('KEYCHAIN_ERROR'));

      // A sign-out goes on all the same.
      await expect(clearIOSPushState('session-c')).resolves.toBeUndefined();
      expect(storage.has('mindroom_ios_push_profile_tag::session-c')).toBe(false);
      expect(storage.get(PENDING_KEY)).toBe('["tag-earlier","tag-c"]');

      // Still refused: nothing is lost.
      vi.mocked(clearNativeNotificationAccount).mockClear();
      vi.mocked(clearNativeNotificationAccount).mockImplementation(async (tag: string) => {
        if (tag === 'tag-c') throw new Error('KEYCHAIN_ERROR');
      });
      await flushPendingNativeNotificationClears();
      expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-earlier');
      expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-c');
      expect(storage.get(PENDING_KEY)).toBe('["tag-c"]');

      // Confirmed at last.
      vi.mocked(clearNativeNotificationAccount).mockClear();
      vi.mocked(clearNativeNotificationAccount).mockImplementation(async () => undefined);
      await flushPendingNativeNotificationClears();
      expect(clearNativeNotificationAccount).toHaveBeenCalledTimes(1);
      expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-c');
      expect(storage.has(PENDING_KEY)).toBe(false);

      await flushPendingNativeNotificationClears();
      expect(clearNativeNotificationAccount).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('drops a noted clear of an account that shares again', async () => {
      vi.mocked(clearNativeNotificationAccount).mockClear();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const storage = stubStorage([]);
      vi.mocked(clearNativeNotificationAccount).mockRejectedValueOnce(new Error('KEYCHAIN_ERROR'));
      await clearNativeNotificationAccountWithRetry('tag-d');
      expect(storage.get(PENDING_KEY)).toBe('["tag-d"]');

      forgetPendingNativeNotificationClear('tag-d');
      expect(storage.has(PENDING_KEY)).toBe(false);

      vi.mocked(clearNativeNotificationAccount).mockClear();
      await flushPendingNativeNotificationClears();
      expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
      warn.mockRestore();
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
