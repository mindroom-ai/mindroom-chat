import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearBuildAssets,
  fetchBuildAsset,
  isBuildAssetRequest,
  keepBuildFile,
  keepOnlyBuildFiles,
} from './swRuntimeAssets';

const WORKER = 'https://app.example/sw.js?version=build-1&non-disruptive-update=1';

const fakeCacheStorage = () => {
  const entries = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response);
    }),
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
  };
  const storage = { open: vi.fn(async () => cache), delete: vi.fn(async () => true) };
  vi.stubGlobal('caches', storage);
  return { entries, storage };
};

const answer = (body: string, init: ResponseInit = {}, type: ResponseType = 'basic') => {
  const response = new Response(body, { status: 200, ...init });
  Object.defineProperty(response, 'type', { value: type });
  return response;
};

const assetEvent = (url: string) => {
  const kept: Promise<unknown>[] = [];
  return {
    event: {
      request: new Request(url),
      waitUntil: (promise: Promise<unknown>) => kept.push(promise),
    },
    kept,
  };
};

describe('isBuildAssetRequest', () => {
  it('takes GET requests for files in the assets directory beside the worker', () => {
    expect(
      isBuildAssetRequest(new Request('https://app.example/assets/emoji-1a2b.js'), WORKER)
    ).toBe(true);
    expect(
      isBuildAssetRequest(
        new Request('https://app.example/app/assets/emoji-1a2b.js'),
        'https://app.example/app/sw.js'
      )
    ).toBe(true);
  });

  it('leaves other paths, origins, methods and range requests to the network', () => {
    const outside = [
      new Request('https://app.example/config.json'),
      new Request('https://app.example/res/branding/mindroom-logo.png'),
      new Request('https://app.example/assetsfoo/x.js'),
      new Request('https://other.example/assets/emoji-1a2b.js'),
      new Request('https://app.example/assets/upload-1a2b.js', { method: 'POST', body: 'x' }),
      new Request('https://app.example/assets/notification-1a2b.ogg', {
        headers: { Range: 'bytes=0-' },
      }),
    ];
    outside.forEach((request) => expect(isBuildAssetRequest(request, WORKER)).toBe(false));
    expect(
      isBuildAssetRequest(
        new Request('https://app.example/assets/emoji-1a2b.js'),
        'https://app.example/app/sw.js'
      )
    ).toBe(false);
  });
});

describe('fetchBuildAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the first answer and serves the kept copy from then on, also offline', async () => {
    const { entries } = fakeCacheStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer('chunk source')));
    const online = assetEvent('https://app.example/assets/emoji-1a2b.js');
    expect(await (await fetchBuildAsset(online.event)).text()).toBe('chunk source');
    await Promise.all(online.kept);
    expect([...entries.keys()]).toEqual(['https://app.example/assets/emoji-1a2b.js']);

    const offlineFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', offlineFetch);
    const offline = assetEvent('https://app.example/assets/emoji-1a2b.js');
    expect(await (await fetchBuildAsset(offline.event)).text()).toBe('chunk source');
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it('never keeps a partial, cross-origin or HTML answer', async () => {
    const { entries } = fakeCacheStorage();
    const answers = [
      answer('part', { status: 206 }),
      answer('', {}, 'opaque'),
      // A single-page host answers a file an older build named with the app page.
      answer('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      answer('missing', { status: 404 }),
    ];
    const fetchMock = vi.fn();
    answers.forEach((response) => fetchMock.mockResolvedValueOnce(response));
    vi.stubGlobal('fetch', fetchMock);
    for (const response of answers) {
      const { event, kept } = assetEvent('https://app.example/assets/old-1a2b.js');
      // eslint-disable-next-line no-await-in-loop
      expect(await fetchBuildAsset(event)).toBe(response);
      expect(kept).toHaveLength(0);
    }
    expect(entries.size).toBe(0);
  });

  it('fails like the network when nothing is kept and the network is gone', async () => {
    fakeCacheStorage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { event } = assetEvent('https://app.example/assets/katex-1a2b.js');
    await expect(fetchBuildAsset(event)).rejects.toThrow('Failed to fetch');
  });

  it('still answers from the network when the cache cannot be opened', async () => {
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('quota')) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer('chunk source')));
    const { event, kept } = assetEvent('https://app.example/assets/emoji-1a2b.js');
    expect(await (await fetchBuildAsset(event)).text()).toBe('chunk source');
    await expect(Promise.all(kept)).resolves.toBeDefined();
  });
});

describe('clearBuildAssets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes the cache the previous build filled', async () => {
    const { storage } = fakeCacheStorage();
    await clearBuildAssets();
    expect(storage.delete).toHaveBeenCalledWith('mindroom-build-assets');
  });

  it('resolves without CacheStorage', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearBuildAssets()).resolves.toBeUndefined();
  });
});

describe('keepOnlyBuildFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the files the new build still has and drops the rest', async () => {
    const { entries, storage } = fakeCacheStorage();
    ['emoji-1a2b.js', 'katex-3c4d.js', 'EmojiBoard-old1.js', 'de-old2.js'].forEach((file) =>
      entries.set(`https://app.example/app/assets/${file}`, answer(file))
    );

    await keepOnlyBuildFiles(
      ['assets/emoji-1a2b.js', 'assets/katex-3c4d.js', 'assets/EmojiBoard-new1.js'],
      'https://app.example/app/sw.js?version=build-2'
    );

    expect([...entries.keys()]).toEqual([
      'https://app.example/app/assets/emoji-1a2b.js',
      'https://app.example/app/assets/katex-3c4d.js',
    ]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('empties the cache when the worker has no list of its build files', async () => {
    const { storage } = fakeCacheStorage();
    await keepOnlyBuildFiles(undefined, WORKER);
    expect(storage.delete).toHaveBeenCalledWith('mindroom-build-assets');
  });
});

describe('keepBuildFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a file of this build no page loaded yet, once', async () => {
    const { entries } = fakeCacheStorage();
    const fetchMock = vi.fn().mockResolvedValue(answer('overlay'));
    vi.stubGlobal('fetch', fetchMock);

    await keepBuildFile('https://app.example/assets/de-1a2b.js');
    await keepBuildFile('https://app.example/assets/de-1a2b.js');

    expect([...entries.keys()]).toEqual(['https://app.example/assets/de-1a2b.js']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps nothing from an HTML answer or a failed fetch, and never throws', async () => {
    const { entries } = fakeCacheStorage();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          answer('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
        )
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    );

    await expect(keepBuildFile('https://app.example/assets/de-1a2b.js')).resolves.toBeUndefined();
    await expect(keepBuildFile('https://app.example/assets/fr-3c4d.js')).resolves.toBeUndefined();
    expect(entries.size).toBe(0);
  });
});
