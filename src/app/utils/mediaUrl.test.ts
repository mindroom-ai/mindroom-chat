import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_STORE_KEY, createSessionId } from '../state/sessions';
import { mxcUrlToHttp } from './mediaUrl';

describe('mxcUrlToHttp', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = globalThis.navigator;

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

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('passes through normal web media urls unchanged', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'https:',
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          controller: { postMessage: () => undefined },
        },
      },
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      mxcUrlToHttp: () => 'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96'
    );
  });

  it('adds an access token for authenticated media on the web before service worker control', () => {
    const sessionId = createSessionId('https://mindroom.chat', '@user:mindroom.chat');
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'https:',
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) =>
          key === SESSION_STORE_KEY
            ? JSON.stringify({
                version: 1,
                activeSessionId: sessionId,
                sessions: [
                  {
                    sessionId,
                    baseUrl: 'https://mindroom.chat',
                    userId: '@user:mindroom.chat',
                    deviceId: 'DEVICE',
                    accessToken: 'secret-token',
                    lastUsedAt: 1,
                  },
                ],
              })
            : null,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          controller: null,
        },
      },
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      mxcUrlToHttp: () =>
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96&access_token=secret-token'
    );
  });

  it('adds an access token for authenticated media on capacitor without service workers', () => {
    const sessionId = createSessionId('https://mindroom.chat', '@user:mindroom.chat');
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'capacitor:',
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) =>
          key === SESSION_STORE_KEY
            ? JSON.stringify({
                version: 1,
                activeSessionId: sessionId,
                sessions: [
                  {
                    sessionId,
                    baseUrl: 'https://mindroom.chat',
                    userId: '@user:mindroom.chat',
                    deviceId: 'DEVICE',
                    accessToken: 'secret-token',
                    lastUsedAt: 1,
                  },
                ],
              })
            : null,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      mxcUrlToHttp: () =>
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96&access_token=secret-token'
    );
  });

  it('does not append a token for non-media urls', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'capacitor:',
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => 'secret-token',
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      mxcUrlToHttp: () => 'https://mindroom.chat/not-media',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe('https://mindroom.chat/not-media');
  });

  it('rebases same-origin media urls to the homeserver path on the web', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'https:',
        },
      },
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://chat-internal.ionq.co/mindroom',
      mxcUrlToHttp: () =>
        'https://chat-internal.ionq.co/_matrix/client/v1/media/download/chat-internal.ionq.co/media-id?allow_redirect=true',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://chat-internal.ionq.co/media-id', true)).toBe(
      'https://chat-internal.ionq.co/mindroom/_matrix/client/v1/media/download/chat-internal.ionq.co/media-id?allow_redirect=true'
    );
  });

  it('does not double-prefix media urls already under the homeserver path', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'https:',
        },
      },
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://chat-internal.ionq.co/mindroom',
      mxcUrlToHttp: () =>
        'https://chat-internal.ionq.co/mindroom/_matrix/client/v1/media/download/chat-internal.ionq.co/media-id?allow_redirect=true',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://chat-internal.ionq.co/media-id', true)).toBe(
      'https://chat-internal.ionq.co/mindroom/_matrix/client/v1/media/download/chat-internal.ionq.co/media-id?allow_redirect=true'
    );
  });
});
