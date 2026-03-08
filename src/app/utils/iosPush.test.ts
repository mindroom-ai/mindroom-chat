import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIOSPushPusherRequest,
  getIOSPushEnabled,
  getStoredIOSPushToken,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  upsertIOSPushPusher,
} from './iosPush';

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
    };
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
});

describe('buildIOSPushPusherRequest', () => {
  it('builds a Matrix HTTP pusher payload', () => {
    const request = buildIOSPushPusherRequest('token-123', {
      appId: 'com.mindroom-ios',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'MindRoom iOS',
      deviceDisplayName: 'iPhone',
      profileTag: 'profile-1',
      append: true,
      format: 'event_id_only',
      lang: 'en',
    });

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
      },
    });
  });
});
