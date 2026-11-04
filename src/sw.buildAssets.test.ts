import { afterEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({ registerRoute: vi.fn() }));
const precache = vi.hoisted(() => ({ activate: vi.fn().mockResolvedValue(undefined) }));

vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  PrecacheController: class PrecacheController {
    activate = precache.activate;

    addToCacheList = vi.fn();

    install = vi.fn().mockResolvedValue(undefined);

    matchPrecache = vi.fn();
  },
  PrecacheRoute: class PrecacheRoute {},
}));

vi.mock('workbox-routing', () => ({
  NavigationRoute: class NavigationRoute {},
  registerRoute: routing.registerRoute,
}));

const ORIGIN = 'https://app.example';

type Listener = (event: unknown) => void;
type MatchCallback = (options: { request: Request; url: URL }) => boolean;
type HandlerCallback = (options: { event: unknown }) => Promise<Response>;

const loadWorker = async (manifest: Array<{ url: string; revision: string | null }>) => {
  vi.resetModules();
  routing.registerRoute.mockClear();
  precache.activate.mockClear();
  const listeners = new Map<string, Listener>();
  const order: string[] = [];
  const cacheStorage = {
    open: vi.fn(async () => ({ match: vi.fn(async () => undefined), put: vi.fn() })),
    delete: vi.fn(async (name: string) => {
      order.push(`delete ${name}`);
      return true;
    }),
  };
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('self', {
    __WB_MANIFEST: manifest,
    location: { href: `${ORIGIN}/sw.js?non-disruptive-update=1`, origin: ORIGIN },
    registration: { active: null, unregister: vi.fn() },
    clients: {
      claim: vi.fn(async () => {
        order.push('claim');
      }),
      get: vi.fn(),
    },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  });
  await import('./sw');
  return { cacheStorage, listeners, order };
};

const matching = (url: string) => ({ request: new Request(url), url: new URL(url) });

/** The routes registered with a match callback and a handler, in registration order. */
const callbackRoutes = () =>
  routing.registerRoute.mock.calls
    .filter((call) => typeof call[0] === 'function')
    .map((call) => ({ match: call[0] as MatchCallback, handle: call[1] as HandlerCallback }));

describe('service worker build assets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the build files outside the precache, after the precache had its turn', async () => {
    await loadWorker([{ url: 'index.html', revision: '1' }]);
    const calls = routing.registerRoute.mock.calls.map((call) => call[0] as unknown);
    const precacheRoute = calls.findIndex((route) => route?.constructor?.name === 'PrecacheRoute');
    const routes = callbackRoutes();
    expect(routes).toHaveLength(1);
    expect(calls.indexOf(routes[0]?.match)).toBeGreaterThan(precacheRoute);

    const route = routes[0];
    if (!route) throw new Error('no build asset route');
    expect(route.match(matching(`${ORIGIN}/assets/emoji-1a2b.js`))).toBe(true);
    expect(route.match(matching(`${ORIGIN}/config.json`))).toBe(false);

    const response = new Response('chunk source', { status: 200 });
    Object.defineProperty(response, 'type', { value: 'basic' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const kept: Promise<unknown>[] = [];
    const event = {
      request: new Request(`${ORIGIN}/assets/emoji-1a2b.js`),
      waitUntil: (promise: Promise<unknown>) => kept.push(promise),
    };
    expect(await (await route.handle({ event })).text()).toBe('chunk source');
    expect(kept).toHaveLength(1);
  });

  it('leaves the development worker, which precaches nothing, to its own cache', async () => {
    await loadWorker([]);
    const routes = callbackRoutes();
    expect(routes).toHaveLength(1);
    // The development route takes the dev server's module paths too, not only assets/.
    expect(routes[0]?.match(matching(`${ORIGIN}/src/index.tsx`))).toBe(true);
  });

  it('empties the previous build files before it takes over the pages', async () => {
    const { listeners, order } = await loadWorker([{ url: 'index.html', revision: '1' }]);
    let lifetime: Promise<unknown> | undefined;
    listeners.get('activate')?.({
      waitUntil: (promise: Promise<unknown>) => {
        lifetime = promise;
      },
    });
    await lifetime;
    expect(precache.activate).toHaveBeenCalledOnce();
    expect(order).toEqual(['delete mindroom-build-assets', 'claim']);
  });
});
