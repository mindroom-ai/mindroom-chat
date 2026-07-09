import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('service worker app shell caching', () => {
  it('precaches the SPA shell for installed PWA cold starts', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');
    const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

    expect(swSource).toContain("from 'workbox-precaching'");
    expect(swSource).toContain('const precacheManifest = self.__WB_MANIFEST');
    expect(swSource).toContain('precacheAndRoute(precacheManifest)');
    expect(swSource).toContain('createHandlerBoundToURL');
    expect(swSource).toContain('new NavigationRoute');
    expect(swSource).toContain('denylist: navigationFallbackDenylist');
    // createHandlerBoundToURL throws for non-precached URLs (dev injects an
    // empty manifest); the fallback must stay guarded on a precached
    // index.html or service worker evaluation fails entirely.
    expect(swSource).toContain("=== 'index.html'");
    expect(swSource).toContain('if (precachesAppShell)');
    expect(viteConfigSource).toContain("injectionPoint: 'self.__WB_MANIFEST'");
    expect(viteConfigSource).toContain('maximumFileSizeToCacheInBytes');
    expect(viteConfigSource).toContain("'public/element-call/**'");
    expect(viteConfigSource).toContain("'runtime-config.js'");
  });

  it('does not use the SPA fallback for same-origin backend routes', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    expect(swSource).toContain('/^\\/api(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_matrix(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_synapse(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?\\.well-known(?:\\/|$)/');
  });

  it('does not use the SPA fallback for path-based Matrix homeserver routes', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_matrix(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_synapse(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?\\.well-known(?:\\/|$)/');
  });

  it('does not use the SPA fallback for static documents like the Element Call widget', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    // The call widget iframe navigates to /public/element-call/index.html
    // (with widget query params, so the precache route never matches it).
    // Answering that navigation with the app shell loads Cinny inside its
    // own call iframe and leaves joins stuck on "Joining" forever.
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?public(?:\\/|$)/');

    const denylistEntry = /^\/(?:[^/]+\/)?public(?:\/|$)/;
    expect(denylistEntry.test('/public/element-call/index.html')).toBe(true);
    expect(denylistEntry.test('/mindroom/public/element-call/index.html')).toBe(true);
    expect(denylistEntry.test('/home/some-room')).toBe(false);
    expect(denylistEntry.test('/')).toBe(false);
  });
});
