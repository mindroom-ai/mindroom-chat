import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_FALLBACK_EXCLUDE_PARAM,
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
