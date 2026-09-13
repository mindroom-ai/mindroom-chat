import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('service worker app shell caching', () => {
  it('precaches the SPA shell for installed PWA cold starts', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');
    const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

    expect(swSource).toContain("from 'workbox-precaching'");
    expect(swSource).toContain('precacheAndRoute(self.__WB_MANIFEST');
    expect(swSource).toContain('createHandlerBoundToURL');
    expect(swSource).toContain('new NavigationRoute');
    expect(swSource).toContain('denylist: navigationFallbackDenylist');
    expect(viteConfigSource).toContain("injectionPoint: 'self.__WB_MANIFEST'");
    expect(viteConfigSource).toContain('maximumFileSizeToCacheInBytes');
    expect(viteConfigSource).toContain("'public/element-call/**'");
    expect(viteConfigSource).toContain("'runtime-config.js'");
  });

  it('does not use the SPA fallback for same-origin backend routes', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    expect(swSource).toContain('/^\\/api(?:\\/|$)/');
    expect(swSource).toContain('/^\\/_matrix(?:\\/|$)/');
    expect(swSource).toContain('/^\\/_synapse(?:\\/|$)/');
    expect(swSource).toContain('/^\\/\\.well-known(?:\\/|$)/');
  });
});
