import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Catalog names stay the same between builds, and browsers may keep files under public/ for a year
// (a deployment's `immutable` cache header), so a new build must ask for its catalog by a URL the
// previous build never used.
describe('language catalog URL', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries the build version', async () => {
    vi.stubGlobal('__MINDROOM_BUILD_VERSION__', 'build 7+a');
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ common: { greeting: 'Hallo' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { default: i18n } = await import('./i18n');
    if (!i18n.isInitialized) {
      await new Promise<void>((resolve) => {
        i18n.on('initialized', () => resolve());
      });
    }
    await i18n.changeLanguage('de');

    expect(fetchMock).toHaveBeenCalledWith(
      '/public/locales/de.json?v=build%207%2Ba',
      expect.objectContaining({ method: 'GET' })
    );
    expect(i18n.t('common.greeting')).toBe('Hallo');
  });
});
