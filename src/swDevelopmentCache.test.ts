import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithDevelopmentCache } from './swDevelopmentCache';

const SCOPE = 'http://127.0.0.1:4200/sw.js';

const fakeCaches = () => {
  const entries = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, response);
    }),
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return entries;
};

const fetchEvent = (url: string, mode: RequestMode = 'cors') => {
  const kept: Promise<unknown>[] = [];
  const request = { url, mode } as Request;
  return { event: { request, waitUntil: (promise: Promise<unknown>) => kept.push(promise) }, kept };
};

const okResponse = (body: string) => {
  const response = new Response(body, { status: 200 });
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
};

describe('fetchWithDevelopmentCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps what the network served and answers with it once the network is gone', async () => {
    const entries = fakeCaches();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okResponse('module source')));
    const online = fetchEvent('http://127.0.0.1:4200/src/index.tsx');
    expect(await (await fetchWithDevelopmentCache(online.event, SCOPE)).text()).toBe(
      'module source'
    );
    await Promise.all(online.kept);
    expect([...entries.keys()]).toEqual(['http://127.0.0.1:4200/src/index.tsx']);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const offline = fetchEvent('http://127.0.0.1:4200/src/index.tsx');
    expect(await (await fetchWithDevelopmentCache(offline.event, SCOPE)).text()).toBe(
      'module source'
    );
  });

  it('keeps one page document for every app route', async () => {
    fakeCaches();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okResponse('<html>shell</html>')));
    const online = fetchEvent('http://127.0.0.1:4200/home/', 'navigate');
    await fetchWithDevelopmentCache(online.event, SCOPE);
    await Promise.all(online.kept);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const offline = fetchEvent('http://127.0.0.1:4200/home/!room?threadId=$root', 'navigate');
    expect(await (await fetchWithDevelopmentCache(offline.event, SCOPE)).text()).toBe(
      '<html>shell</html>'
    );
  });

  it('keeps no error answers and fails offline without a kept copy', async () => {
    const entries = fakeCaches();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 })));
    const missing = fetchEvent('http://127.0.0.1:4200/missing.js');
    expect((await fetchWithDevelopmentCache(missing.event, SCOPE)).status).toBe(404);
    expect(missing.kept).toEqual([]);
    expect(entries.size).toBe(0);

    const failure = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await expect(
      fetchWithDevelopmentCache(fetchEvent('http://127.0.0.1:4200/missing.js').event, SCOPE)
    ).rejects.toBe(failure);
  });
});
