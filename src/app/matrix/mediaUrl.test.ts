import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from 'matrix-js-sdk';
import { authenticatedMediaRequestInit, mxcUrlToHttp } from './mediaUrl';

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

  it('keeps authenticated media URLs token-free on capacitor without service workers', () => {
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
      mxcUrlToHttp: () =>
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96',
    } as any;

    const url = mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop');
    expect(url).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96&height=96'
    );
    expect(url).not.toContain('access_token');
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

  it("builds a URL without a token once per client: every row renders its avatar's", () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:' } },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    const build = vi.fn(
      (mxc: string, width?: number) =>
        `https://mindroom.chat/_matrix/client/v1/media/thumbnail/${mxc.slice(6)}?width=${width}`
    );
    const mx = { getHomeserverUrl: () => 'https://mindroom.chat', mxcUrlToHttp: build } as any;

    const url = 'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/cached?width=96';
    expect(mxcUrlToHttp(mx, 'mxc://server/cached', true, 96, 96, 'crop')).toBe(url);
    expect(mxcUrlToHttp(mx, 'mxc://server/cached', true, 96, 96, 'crop')).toBe(url);
    expect(build).toHaveBeenCalledTimes(1);

    expect(mxcUrlToHttp(mx, 'mxc://server/cached', true, 36, 36, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/cached?width=36'
    );
    expect(build).toHaveBeenCalledTimes(2);

    const otherClient = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      mxcUrlToHttp: () => 'https://mindroom.chat/_matrix/client/v1/media/download/server/cached',
    } as any;
    expect(mxcUrlToHttp(otherClient, 'mxc://server/cached', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/download/server/cached'
    );
  });

  it('caches token-free media URLs per client on capacitor across token refreshes', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'capacitor:' } },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    let token = 'first-token';
    const build = vi.fn(() => 'https://mindroom.chat/_matrix/client/v1/media/download/server/id');
    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      getAccessToken: () => token,
      mxcUrlToHttp: build,
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/download/server/id'
    );
    token = 'second-token';
    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/download/server/id'
    );
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('never appends an access_token in the desktop app, even on capacitor://localhost', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: { protocol: 'capacitor:' },
        mindroomDesktop: { onShellEvent: vi.fn(() => vi.fn()) },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    const mx = {
      getHomeserverUrl: () => 'https://mindroom.chat',
      getAccessToken: () => 'desktop-secret-token',
      mxcUrlToHttp: () => 'https://mindroom.chat/_matrix/client/v1/media/download/server/id',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/download/server/id'
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

describe('authenticatedMediaRequestInit', () => {
  const mx = createClient({
    baseUrl: 'https://matrix.example.org',
    userId: '@alice:example.org',
    accessToken: 'test-token',
  });
  const mediaUrl = 'https://matrix.example.org/_matrix/client/v1/media/download/example.org/media';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the access token in a header to the homeserver media URL', () => {
    expect(authenticatedMediaRequestInit(mx, mediaUrl)).toEqual({
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('sets cache no-store on Capacitor shells and leaves Electron desktop unchanged', () => {
    vi.stubGlobal('window', { location: { protocol: 'capacitor:' } });
    expect(authenticatedMediaRequestInit(mx, mediaUrl)).toEqual({
      headers: { Authorization: 'Bearer test-token' },
      cache: 'no-store',
    });

    vi.stubGlobal('window', {
      location: { protocol: 'capacitor:' },
      mindroomDesktop: { onShellEvent: vi.fn(() => vi.fn()) },
    });
    expect(authenticatedMediaRequestInit(mx, mediaUrl)).toEqual({
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('sends the Bearer header even if an unrelated query parameter is present and skips legacy or foreign URLs', () => {
    expect(authenticatedMediaRequestInit(mx, `${mediaUrl}?access_token=legacy`)).toEqual({
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://matrix.example.org/_matrix/media/v3/download/example.org/media'
      )
    ).toBeUndefined();
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://other.example.org/_matrix/client/v1/media/download/example.org/media'
      )
    ).toBeUndefined();
  });
});
