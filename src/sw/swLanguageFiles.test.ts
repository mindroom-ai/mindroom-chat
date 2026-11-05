import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLanguageCatalog,
  isLanguageCatalogRequest,
  keepLanguageOverlays,
} from './swLanguageFiles';

const WORKER = 'https://app.example/sw.js?version=build-2&non-disruptive-update=1';

/** CacheStorage with one map per cache name. */
const fakeCacheStorage = () => {
  const stores = new Map<string, Map<string, Response>>();
  const open = vi.fn(async (name: string) => {
    const entries = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, entries);
    return {
      put: vi.fn(async (request: Request, response: Response) => {
        entries.set(request.url, response);
      }),
      match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
      keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    };
  });
  vi.stubGlobal('caches', { open, delete: vi.fn(async () => true) });
  const urls = (name: string) => [...(stores.get(name)?.keys() ?? [])];
  return { stores, urls };
};

const answer = (body: string, init: ResponseInit = {}) => {
  const response = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
};

const catalogEvent = (url: string) => {
  const kept: Promise<unknown>[] = [];
  return {
    event: {
      request: new Request(url),
      waitUntil: (promise: Promise<unknown>) => kept.push(promise),
    },
    kept,
  };
};

describe('isLanguageCatalogRequest', () => {
  it('takes GETs of a catalog in public/locales beside the worker', () => {
    expect(
      isLanguageCatalogRequest(new Request('https://app.example/public/locales/de.json'), WORKER)
    ).toBe(true);
    expect(
      isLanguageCatalogRequest(
        new Request('https://app.example/app/public/locales/zh-TW.json'),
        'https://app.example/app/sw.js'
      )
    ).toBe(true);
  });

  it('leaves every other path, origin and method alone', () => {
    [
      new Request('https://app.example/public/locales/de.json', { method: 'POST', body: '{}' }),
      new Request('https://other.example/public/locales/de.json'),
      new Request('https://app.example/public/licenses/LICENSE'),
      new Request('https://app.example/public/locales/sub/de.json'),
      new Request('https://app.example/assets/de-1a2b.js'),
    ].forEach((request) => expect(isLanguageCatalogRequest(request, WORKER)).toBe(false));
    expect(
      isLanguageCatalogRequest(
        new Request('https://app.example/public/locales/de.json'),
        'https://app.example/app/sw.js'
      )
    ).toBe(false);
  });
});

describe('fetchLanguageCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers from the network and keeps the copy for an offline start', async () => {
    const { urls } = fakeCacheStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer('{"nav":"Startseite"}')));
    const online = catalogEvent('https://app.example/public/locales/de.json');
    expect(await (await fetchLanguageCatalog(online.event)).text()).toBe('{"nav":"Startseite"}');
    await Promise.all(online.kept);
    expect(urls('mindroom-languages')).toEqual(['https://app.example/public/locales/de.json']);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const offline = catalogEvent('https://app.example/public/locales/de.json');
    expect(await (await fetchLanguageCatalog(offline.event)).text()).toBe('{"nav":"Startseite"}');
  });

  it('prefers the network over a kept copy, and keeps no HTML or failed answer', async () => {
    const { urls } = fakeCacheStorage();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer('{"v":1}'))
      .mockResolvedValueOnce(answer('{"v":2}'))
      .mockResolvedValueOnce(
        answer('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
      )
      .mockResolvedValueOnce(answer('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://app.example/public/locales/fr.json';

    for (const expected of ['{"v":1}', '{"v":2}']) {
      const { event, kept } = catalogEvent(url);
      // eslint-disable-next-line no-await-in-loop
      expect(await (await fetchLanguageCatalog(event)).text()).toBe(expected);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(kept);
    }
    for (const status of [200, 404]) {
      const { event, kept } = catalogEvent(url);
      // eslint-disable-next-line no-await-in-loop
      expect((await fetchLanguageCatalog(event)).status).toBe(status);
      expect(kept).toHaveLength(0);
    }
    expect(urls('mindroom-languages')).toEqual([url]);
  });

  it('fails like the network when offline with nothing kept', async () => {
    fakeCacheStorage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { event } = catalogEvent('https://app.example/public/locales/ja.json');
    await expect(fetchLanguageCatalog(event)).rejects.toThrow('Failed to fetch');
  });
});

describe('keepLanguageOverlays', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps this build's overlay for each language a page loaded, and no other", async () => {
    const { stores, urls } = fakeCacheStorage();
    stores.set(
      'mindroom-languages',
      new Map([
        ['https://app.example/public/locales/de.json', answer('{}')],
        ['https://app.example/public/locales/zh-TW.json', answer('{}')],
      ])
    );
    const fetchMock = vi.fn(async () => answer('overlay', { headers: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await keepLanguageOverlays(
      { de: 'assets/de-new1.js', fr: 'assets/fr-new2.js', 'zh-TW': 'assets/zh-TW-new3.js' },
      WORKER
    );

    expect(urls('mindroom-build-assets').sort()).toEqual([
      'https://app.example/assets/de-new1.js',
      'https://app.example/assets/zh-TW-new3.js',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing without an inventory or a kept catalog', async () => {
    const { urls } = fakeCacheStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await keepLanguageOverlays(undefined, WORKER);
    await keepLanguageOverlays({ de: 'assets/de-new1.js' }, WORKER);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(urls('mindroom-build-assets')).toEqual([]);
  });
});
