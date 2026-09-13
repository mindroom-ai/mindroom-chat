import { afterEach, describe, expect, it } from 'vitest';
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

    const mx = {
      mxcUrlToHttp: () => 'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true, 96, 96, 'crop')).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/id?width=96'
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
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => (key === 'cinny_access_token' ? 'secret-token' : null),
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const mx = {
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
      mxcUrlToHttp: () => 'https://mindroom.chat/not-media',
    } as any;

    expect(mxcUrlToHttp(mx, 'mxc://server/id', true)).toBe('https://mindroom.chat/not-media');
  });
});
