import { afterEach, describe, expect, it, vi } from 'vitest';
import { mxcUrlToHttp } from './mediaUrl';

describe('mxcUrlToHttp', () => {
  const originalWindow = globalThis.window;
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
      mxcUrlToHttp: () =>
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96'
    );
  });

  it('keeps authenticated browser media token-free before service worker control', () => {
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
          controller: null,
        },
      },
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      getAccessToken: () => 'client-token',
      mxcUrlToHttp: () =>
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96'
    );
  });

  it('adds an access token for authenticated media on capacitor without service workers', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          protocol: 'capacitor:',
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const nativeMediaUrl = vi.fn(
      () =>
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96&allow_redirect=true'
    );
    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      getAccessToken: () => 'client-token',
      mxcUrlToHttp: nativeMediaUrl,
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96&allow_redirect=false&access_token=client-token'
    );
    expect(nativeMediaUrl).toHaveBeenCalledWith(
      'mxc://server/id',
      96,
      96,
      'crop',
      undefined,
      false,
      true
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
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      getAccessToken: () => 'client-token',
      mxcUrlToHttp: () => 'https://mindroom.chat/not-media',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe('https://mindroom.chat/not-media');
  });

  it('never appends the client token to a different origin', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'capacitor:' } },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      getAccessToken: () => 'client-token',
      mxcUrlToHttp: () => 'https://attacker.example/_matrix/client/v1/media/download/server/id',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe(
      'https://attacker.example/_matrix/client/v1/media/download/server/id'
    );
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
      getHomeserverUrl: () => 'https://example.test/mindroom',
      mxcUrlToHttp: () =>
        'https://example.test/_matrix/client/v1/media/download/example.test/media-id?allow_redirect=true',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://example.test/media-id', true)).toBe(
      'https://example.test/mindroom/_matrix/client/v1/media/download/example.test/media-id?allow_redirect=true'
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
      getHomeserverUrl: () => 'https://example.test/mindroom',
      mxcUrlToHttp: () =>
        'https://example.test/mindroom/_matrix/client/v1/media/download/example.test/media-id?allow_redirect=true',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://example.test/media-id', true)).toBe(
      'https://example.test/mindroom/_matrix/client/v1/media/download/example.test/media-id?allow_redirect=true'
    );
  });
});
