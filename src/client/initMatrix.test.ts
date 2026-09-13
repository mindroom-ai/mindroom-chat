import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBrowserCacheAndReload } from './initMatrix';

vi.mock('matrix-js-sdk', () => ({
  MatrixClient: vi.fn(),
  IndexedDBStore: vi.fn(),
  IndexedDBCryptoStore: vi.fn(),
}));

vi.mock('./secretStorageKeys', () => ({
  cryptoCallbacks: {},
}));

vi.mock('./matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('../app/state/navToActivePath', () => ({
  clearNavToActivePathStore: vi.fn(),
}));

describe('clearBrowserCacheAndReload', () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalBasePath = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalBasePath;

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

  it('unregisters and clears only app-scoped browser cache resources', async () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom';

    const unregisterApp = vi.fn().mockResolvedValue(true);
    const unregisterOther = vi.fn().mockResolvedValue(true);
    const appRegistration = {
      scope: 'https://example.com/mindroom/',
      active: { scriptURL: 'https://example.com/mindroom/sw.js' },
      installing: null,
      waiting: null,
      unregister: unregisterApp,
    } as unknown as ServiceWorkerRegistration;
    const otherRegistration = {
      scope: 'https://example.com/other/',
      active: { scriptURL: 'https://example.com/other/sw.js' },
      installing: null,
      waiting: null,
      unregister: unregisterOther,
    } as unknown as ServiceWorkerRegistration;
    const getRegistrations = vi.fn().mockResolvedValue([appRegistration, otherRegistration]);

    const appRequest = { url: 'https://example.com/mindroom/assets/index.js' } as Request;
    const otherRequest = { url: 'https://example.com/other/assets/index.js' } as Request;

    const appCache = {
      keys: vi
        .fn()
        .mockResolvedValueOnce([appRequest, otherRequest])
        .mockResolvedValueOnce([otherRequest]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const otherCache = {
      keys: vi.fn().mockResolvedValueOnce([otherRequest]).mockResolvedValueOnce([otherRequest]),
      delete: vi.fn().mockResolvedValue(false),
    };
    const deleteCacheName = vi.fn().mockResolvedValue(true);

    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['cache-a', 'cache-b']),
      open: vi.fn().mockImplementation((cacheName: string) => {
        if (cacheName === 'cache-a') {
          return Promise.resolve(appCache as unknown as Cache);
        }
        return Promise.resolve(otherCache as unknown as Cache);
      }),
      delete: deleteCacheName,
    };

    const reload = vi.fn();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          getRegistrations,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          reload,
        },
        caches: cacheStorage,
      },
      configurable: true,
    });

    await clearBrowserCacheAndReload();

    expect(unregisterApp).toHaveBeenCalledTimes(1);
    expect(unregisterOther).not.toHaveBeenCalled();
    expect(appCache.delete).toHaveBeenCalledTimes(1);
    expect(appCache.delete).toHaveBeenCalledWith(appRequest);
    expect(otherCache.delete).not.toHaveBeenCalled();
    expect(deleteCacheName).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
