import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_FALLBACK_EXCLUDE_PARAM,
  fetchNavigationWithShellFallback,
  navigationFallbackExcludePathPattern,
  normalizeNavigationFallbackExcludePaths,
  readNavigationFallbackExcludePaths,
} from './serviceWorkerNavigation';

describe('service worker navigation fallback exclusions', () => {
  it('normalizes safe root-relative path prefixes', () => {
    expect(
      normalizeNavigationFallbackExcludePaths([
        ' /other-app/ ',
        '/other-app',
        '/control.panel',
        '/',
        'relative',
        '//another-origin/path',
        '/with?query',
        '/with#fragment',
        '/another\\origin',
        '/nested/..',
        '/\u0000',
        42,
      ])
    ).toEqual(['/other-app', '/control.panel']);
  });

  it('canonicalizes paths the same way as browser navigation URLs', () => {
    expect(normalizeNavigationFallbackExcludePaths(['/café', '/nested/../other-app'])).toEqual([
      '/caf%C3%A9',
      '/other-app',
    ]);
  });

  it('reads repeated exclusions from the registered worker URL', () => {
    const url = new URL('https://chat.example.com/sw.js?version=abc123');
    url.searchParams.append(NAVIGATION_FALLBACK_EXCLUDE_PARAM, '/other-app');
    url.searchParams.append(NAVIGATION_FALLBACK_EXCLUDE_PARAM, '/control.panel/');

    expect(readNavigationFallbackExcludePaths(url.href)).toEqual(['/other-app', '/control.panel']);
    expect(readNavigationFallbackExcludePaths('not a URL')).toEqual([]);
  });

  it('matches exact prefixes without swallowing similarly named client routes', () => {
    const otherApp = navigationFallbackExcludePathPattern('/other-app');
    const controlPanel = navigationFallbackExcludePathPattern('/control.panel');

    expect(otherApp.test('/other-app')).toBe(true);
    expect(otherApp.test('/other-app/settings')).toBe(true);
    expect(otherApp.test('/other-app?tab=users')).toBe(true);
    expect(otherApp.test('/other-application')).toBe(false);
    expect(controlPanel.test('/control.panel/users')).toBe(true);
    expect(controlPanel.test('/controlXpanel/users')).toBe(false);
    expect(otherApp.test('/home/some-room')).toBe(false);
  });
});

describe('service worker navigation responses', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses a fresh network document before the precached shell', async () => {
    const request = new Request('https://chat.example.com/home/room');
    const networkResponse = new Response('new shell');
    const fetchMock = vi.fn().mockResolvedValue(networkResponse);
    const loadCachedShell = vi.fn().mockResolvedValue(new Response('cached shell'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNavigationWithShellFallback(request, loadCachedShell)).resolves.toBe(
      networkResponse
    );
    expect(fetchMock).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })
    );
    expect(loadCachedShell).not.toHaveBeenCalled();
  });

  it('returns an opaque navigation redirect for the browser to follow', async () => {
    const request = new Request('https://chat.example.com/home');
    const redirectResponse = { ok: false, type: 'opaqueredirect' } as Response;
    const loadCachedShell = vi.fn().mockResolvedValue(new Response('cached shell'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirectResponse));

    await expect(fetchNavigationWithShellFallback(request, loadCachedShell)).resolves.toBe(
      redirectResponse
    );
    expect(loadCachedShell).not.toHaveBeenCalled();
  });

  it('aborts a stalled navigation before falling back to the precached shell', async () => {
    vi.useFakeTimers();
    const request = new Request('https://chat.example.com/home/room');
    const cachedResponse = new Response('cached shell');
    const loadCachedShell = vi.fn().mockResolvedValue(cachedResponse);
    vi.stubGlobal(
      'fetch',
      vi.fn((_request: Request, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      })
    );

    const response = fetchNavigationWithShellFallback(request, loadCachedShell, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(response).resolves.toBe(cachedResponse);
    expect(loadCachedShell).toHaveBeenCalledOnce();
  });

  it.each([
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['unsuccessful response', () => Promise.resolve(new Response('missing', { status: 404 }))],
  ])('falls back to the precached shell after %s', async (_label, fetchResult) => {
    const request = new Request('https://chat.example.com/home/room');
    const cachedResponse = new Response('cached shell');
    const loadCachedShell = vi.fn().mockResolvedValue(cachedResponse);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(fetchResult));

    await expect(fetchNavigationWithShellFallback(request, loadCachedShell)).resolves.toBe(
      cachedResponse
    );
    expect(loadCachedShell).toHaveBeenCalledOnce();
  });
});
