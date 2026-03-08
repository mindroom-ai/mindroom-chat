import { afterEach, describe, expect, it } from 'vitest';
import { getDirectRoomAvatarUrl, getRoomAvatarUrl } from './room';

describe('room avatar urls', () => {
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

  it('uses the capacitor-safe media helper for room avatars', () => {
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
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/room-avatar?width=96&height=96',
    } as any;
    const room = {
      getMxcAvatarUrl: () => 'mxc://server/room-avatar',
    } as any;

    expect(getRoomAvatarUrl(mx, room, 96, true)).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/room-avatar?width=96&height=96&access_token=secret-token'
    );
  });

  it('uses the fallback member avatar through the same helper', () => {
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
        'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/direct-avatar?width=96&height=96',
    } as any;
    const room = {
      getAvatarFallbackMember: () => ({
        getMxcAvatarUrl: () => 'mxc://server/direct-avatar',
      }),
      getMxcAvatarUrl: () => 'mxc://server/room-avatar',
    } as any;

    expect(getDirectRoomAvatarUrl(mx, room, 96, true)).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/server/direct-avatar?width=96&height=96&access_token=secret-token'
    );
  });
});
