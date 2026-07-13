import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
  precacheAndRoute: vi.fn(),
}));

vi.mock('workbox-routing', () => ({
  NavigationRoute: class NavigationRoute {},
  registerRoute: vi.fn(),
}));

const APP_ORIGIN = 'https://app.example';
type CapturedListener = (event: unknown) => void;

const loadServiceWorker = async (hasActiveWorker: boolean) => {
  vi.resetModules();
  const listeners = new Map<string, CapturedListener>();
  let hasUpdateMarker = false;

  const cache = {
    put: vi.fn(async () => {
      hasUpdateMarker = true;
    }),
    match: vi.fn(async () => (hasUpdateMarker ? new Response('pending') : undefined)),
  };
  const cacheStorage = {
    open: vi.fn(async () => cache),
    delete: vi.fn(async () => {
      hasUpdateMarker = false;
      return true;
    }),
  };
  const client = {
    id: 'client-a',
    url: `${APP_ORIGIN}/rooms`,
    frameType: 'top-level',
    navigate: vi.fn().mockResolvedValue(undefined),
  };
  const clients = {
    claim: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    matchAll: vi.fn().mockResolvedValue([client]),
  };
  const scope = {
    __WB_MANIFEST: [{ url: 'index.html', revision: 'test' }],
    registration: {
      scope: `${APP_ORIGIN}/`,
      active: hasActiveWorker ? {} : null,
    },
    location: { origin: APP_ORIGIN },
    clients,
    addEventListener: (type: string, listener: CapturedListener) => {
      listeners.set(type, listener);
    },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
  };

  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', cacheStorage);
  await import('./sw');

  const dispatchExtendableEvent = async (type: 'install' | 'activate') => {
    let lifetimePromise: Promise<unknown> | undefined;
    listeners.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => {
        lifetimePromise = promise;
      },
    });
    expect(lifetimePromise).toBeDefined();
    await lifetimePromise;
  };

  return {
    cache,
    cacheStorage,
    client,
    clients,
    dispatchExtendableEvent,
    scope,
  };
};

describe('service worker upgrade lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('claims and reloads existing top-level clients after an upgrade', async () => {
    const { cache, cacheStorage, client, clients, dispatchExtendableEvent, scope } =
      await loadServiceWorker(true);

    await dispatchExtendableEvent('install');
    expect(cache.put).toHaveBeenCalledOnce();
    expect(scope.skipWaiting).toHaveBeenCalledOnce();

    await dispatchExtendableEvent('activate');
    expect(cache.match).toHaveBeenCalledOnce();
    expect(cacheStorage.delete).toHaveBeenCalledWith('mindroom-service-worker-update');
    expect(clients.claim).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith(client.url);
    expect(clients.claim.mock.invocationCallOrder[0]).toBeLessThan(
      client.navigate.mock.invocationCallOrder[0]
    );
  });

  it('does not reload clients when no worker was active during install', async () => {
    const { cache, client, dispatchExtendableEvent } = await loadServiceWorker(false);

    await dispatchExtendableEvent('install');
    await dispatchExtendableEvent('activate');

    expect(cache.put).not.toHaveBeenCalled();
    expect(client.navigate).not.toHaveBeenCalled();
  });
});
