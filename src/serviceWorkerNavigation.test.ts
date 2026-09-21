import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTHENTICATION_RECOVERY_NAVIGATION_PARAM,
  NAVIGATION_FALLBACK_EXCLUDE_PARAM,
  fetchNavigationWithShellFallback,
  isAuthenticationRecoveryNavigation,
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
    vi.unstubAllGlobals();
  });

  it('returns the precached shell while the network navigation remains held', async () => {
    const request = new Request('https://chat.example.com/home/room');
    const cachedResponse = new Response('cached shell');
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(() => {
          // Held network navigation.
        })
    );
    const loadCachedShell = vi.fn().mockResolvedValue(cachedResponse);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNavigationWithShellFallback(request, loadCachedShell)).resolves.toBe(
      cachedResponse
    );
    expect(loadCachedShell).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', () => Promise.reject(new Error('missing shell'))],
    ['unusable', () => Promise.resolve(new Response('missing', { status: 404 }))],
  ])('uses the network when the precached shell is %s', async (_label, loadCachedShell) => {
    const request = new Request('https://chat.example.com/home');
    const redirectResponse = { ok: false, type: 'opaqueredirect' } as Response;
    const fetchMock = vi.fn().mockResolvedValue(redirectResponse);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNavigationWithShellFallback(request, loadCachedShell)).resolves.toBe(
      redirectResponse
    );
    expect(fetchMock).toHaveBeenCalledWith(request, { cache: 'no-store' });
  });

  it('uses the network for a marked authentication recovery navigation', async () => {
    const request = new Request(
      `https://chat.example.com/home/room?tab=members&${AUTHENTICATION_RECOVERY_NAVIGATION_PARAM}=1`
    );
    const redirectResponse = { ok: false, type: 'opaqueredirect' } as Response;
    const loadCachedShell = vi.fn().mockResolvedValue(new Response('cached shell'));
    const fetchMock = vi.fn().mockResolvedValue(redirectResponse);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchNavigationWithShellFallback(request, loadCachedShell)).resolves.toBe(
      redirectResponse
    );
    expect(isAuthenticationRecoveryNavigation(request.url)).toBe(true);
    expect(loadCachedShell).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(request, { cache: 'no-store' });
  });

  it('ignores absent, malformed, and unrelated authentication recovery markers', () => {
    expect(isAuthenticationRecoveryNavigation('https://chat.example.com/home')).toBe(false);
    expect(
      isAuthenticationRecoveryNavigation(
        `https://chat.example.com/home?${AUTHENTICATION_RECOVERY_NAVIGATION_PARAM}=0`
      )
    ).toBe(false);
    expect(isAuthenticationRecoveryNavigation('not a URL')).toBe(false);
  });
});
