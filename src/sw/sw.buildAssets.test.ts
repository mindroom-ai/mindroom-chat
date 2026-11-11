import { afterEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({ registerRoute: vi.fn() }));
const precache = vi.hoisted(() => ({
  activate: vi.fn().mockResolvedValue(undefined),
  install: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  PrecacheController: class PrecacheController {
    activate = precache.activate;

    addToCacheList = vi.fn();

    install = precache.install;

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

type Inventory = { files: string[]; localeOverlays: Record<string, string> };

const loadWorker = async (
  manifest: Array<{ url: string; revision: string | null }>,
  { inventory, kept = {} }: { inventory?: Inventory; kept?: Record<string, string[]> } = {}
) => {
  vi.resetModules();
  routing.registerRoute.mockClear();
  precache.activate.mockClear();
  precache.install.mockClear();
  const listeners = new Map<string, Listener[]>();
  const order: string[] = [];
  // Cache name to the URLs it holds.
  const stores = new Map(Object.entries(kept).map(([name, urls]) => [name, new Set(urls)]));
  const cacheStorage = {
    open: vi.fn(async (name: string) => {
      const urls = stores.get(name) ?? new Set<string>();
      stores.set(name, urls);
      return {
        match: vi.fn(async (request: Request) =>
          urls.has(request.url) ? new Response('kept') : undefined
        ),
        put: vi.fn(async (request: Request) => {
          urls.add(request.url);
        }),
        keys: vi.fn(async () => [...urls].map((url) => new Request(url))),
        delete: vi.fn(async (request: Request) => {
          order.push(`drop ${new URL(request.url).pathname}`);
          return urls.delete(request.url);
        }),
      };
    }),
    delete: vi.fn(async (name: string) => {
      order.push(`delete ${name}`);
      return stores.delete(name);
    }),
  };
  vi.stubGlobal('caches', cacheStorage);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('self', {
    __WB_MANIFEST: manifest,
    ...(inventory ? { __MINDROOM_BUILD_INVENTORY: inventory } : {}),
    location: { href: `${ORIGIN}/sw.js?non-disruptive-update=1`, origin: ORIGIN },
    registration: { active: {}, unregister: vi.fn() },
    clients: {
      claim: vi.fn(async () => {
        order.push('claim');
      }),
      get: vi.fn(),
    },
    skipWaiting,
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  });
  await import('./sw');
  const dispatch = async (type: 'install' | 'activate') => {
    let lifetime: Promise<unknown> | undefined;
    listeners.get(type)?.forEach((listener) =>
      listener({
        waitUntil: (promise: Promise<unknown>) => {
          lifetime = promise;
        },
      })
    );
    await lifetime;
  };
  const post = (data: unknown, source: { id?: string; url?: string } = {}) =>
    listeners.get('message')?.forEach((listener) => listener({ data, source }));
  const urlsOf = (name: string) => [...(stores.get(name) ?? [])];
  return { cacheStorage, dispatch, order, post, skipWaiting, urlsOf };
};

const response = (body: string, contentType = 'text/javascript') => {
  const answer = new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
  Object.defineProperty(answer, 'type', { value: 'basic' });
  return answer;
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
    expect(routes).toHaveLength(2);
    routes.forEach(({ match }) => expect(calls.indexOf(match)).toBeGreaterThan(precacheRoute));

    const route = routes[0];
    if (!route) throw new Error('no build asset route');
    expect(route.match(matching(`${ORIGIN}/assets/emoji-1a2b.js`))).toBe(true);
    expect(route.match(matching(`${ORIGIN}/config.json`))).toBe(false);
    expect(routes[1]?.match(matching(`${ORIGIN}/public/locales/de.json`))).toBe(true);
    expect(routes[1]?.match(matching(`${ORIGIN}/assets/emoji-1a2b.js`))).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('chunk source')));
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

  it("drops the previous build's kept files this build does not have before it takes over", async () => {
    const { dispatch, order, urlsOf } = await loadWorker([{ url: 'index.html', revision: '1' }], {
      inventory: {
        files: ['assets/emoji-1a2b.js', 'assets/EmojiBoard-new.js'],
        localeOverlays: {},
      },
      kept: {
        'mindroom-build-assets': [
          `${ORIGIN}/assets/emoji-1a2b.js`,
          `${ORIGIN}/assets/EmojiBoard-old.js`,
        ],
      },
    });
    await dispatch('activate');
    expect(precache.activate).toHaveBeenCalledOnce();
    expect(order).toEqual(['drop /assets/EmojiBoard-old.js', 'claim']);
    expect(urlsOf('mindroom-build-assets')).toEqual([`${ORIGIN}/assets/emoji-1a2b.js`]);
  });

  it('empties the kept files when the worker has no build inventory', async () => {
    const { dispatch, order } = await loadWorker([{ url: 'index.html', revision: '1' }]);
    await dispatch('activate');
    expect(order).toEqual(['delete mindroom-build-assets', 'claim']);
  });

  it("installs with this build's overlay for the languages the pages used", async () => {
    const { dispatch, urlsOf } = await loadWorker([{ url: 'index.html', revision: '1' }], {
      inventory: {
        files: ['assets/de-new.js', 'assets/fr-new.js'],
        localeOverlays: { de: 'assets/de-new.js', fr: 'assets/fr-new.js' },
      },
      kept: { 'mindroom-languages': [`${ORIGIN}/public/locales/de.json`] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('overlay')));
    await dispatch('install');
    expect(precache.install).toHaveBeenCalledOnce();
    expect(urlsOf('mindroom-build-assets')).toEqual([`${ORIGIN}/assets/de-new.js`]);
  });

  it('takes over when a page of this origin asks, and only then', async () => {
    const { post, skipWaiting } = await loadWorker([{ url: 'index.html', revision: '1' }]);
    post({ type: 'takeOver' }, { id: 'tab', url: 'https://elsewhere.example/' });
    post({ type: 'takeOver' });
    post({ type: 'setSession', accessToken: '', baseUrl: '' }, { id: 'tab', url: `${ORIGIN}/` });
    expect(skipWaiting).not.toHaveBeenCalled();

    post({ type: 'takeOver' }, { id: 'tab', url: `${ORIGIN}/home/` });
    expect(skipWaiting).toHaveBeenCalledOnce();
  });

  it('claims the pages of this origin when one that it does not control asks', async () => {
    const { order, post } = await loadWorker([{ url: 'index.html', revision: '1' }]);
    post({ type: 'claim' }, { id: 'tab', url: 'https://elsewhere.example/' });
    post({ type: 'claim' });
    expect(order).toEqual([]);

    post({ type: 'claim' }, { id: 'tab', url: `${ORIGIN}/home/` });
    expect(order).toEqual(['claim']);
  });
});
