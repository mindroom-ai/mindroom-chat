// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocaleTree } from '../i18n/englishResources';

// A plugin's strings, as the registry registers them from its descriptor: English ships with the
// plugin, and another language's strings come from its loader while that language is in use. The
// app's own catalogs come from the deployment (fetch, stubbed here).
const ENGLISH = { label: 'Example plugin', greeting: { hello: 'Hello, {{name}}' } };
const GERMAN = { label: 'Beispiel-Plugin', greeting: { hello: 'Hallo, {{name}}' } };

const plugins = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('./pluginEntries', () => ({ pluginEntries: plugins.entries }));

/** A loader with strings for German only. */
const germanOnly = () =>
  vi.fn(async (language: string) => (language === 'de' ? GERMAN : undefined));

/** A loader whose strings for German arrive only once `release` is called. */
const heldLoader = () => {
  let release: () => void = () => undefined;
  const german = new Promise<LocaleTree>((resolve) => {
    release = () => resolve(GERMAN);
  });
  const load = async (language: string) => (language === 'de' ? german : undefined);
  return { load, release };
};

/** Serves the app's catalogs; while `held`, they answer only once `release` is called. */
const stubCatalogs = ({ held = false } = {}) => {
  let release: () => void = () => undefined;
  const released = held
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  vi.stubGlobal('fetch', async (url: string) => {
    await released;
    return Response.json(url.includes('/de.json') ? { nav: { home: 'Startseite' } } : {});
  });
  return { release };
};

/** Lets the loads that are under way finish. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('plugin translations', () => {
  let i18n: typeof import('../i18n/i18n').default;
  let translations: typeof import('./pluginTranslations');

  /** A fresh page load with these plugin descriptors, in a browser that prefers `language`. */
  const loadPage = async (descriptors: Record<string, unknown>, language = 'en') => {
    plugins.entries.splice(
      0,
      plugins.entries.length,
      ...Object.entries(descriptors).map(([id, plugin]) => ({ id, version: '1.0.0', plugin }))
    );
    vi.stubGlobal('navigator', { language, languages: [language] });
    ({ default: i18n } = await import('../i18n/i18n'));
    translations = await import('./pluginTranslations');
    // Loading the registry registers the plugins' strings.
    await import('./registry');
  };

  function Label() {
    const t = translations.usePluginTranslation('demo');
    return (
      <p>
        {t('label')} / {t('greeting.hello', { name: 'Ada' })}
      </p>
    );
  }

  beforeEach(() => {
    vi.resetModules();
    // i18next keeps one instance for the process, which a fresh import of the setup would share:
    // each test sets up its own.
    vi.doMock('i18next', async (importOriginal) => {
      const actual = await importOriginal<typeof import('i18next')>();
      return { ...actual, default: actual.default.createInstance() };
    });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.doUnmock('i18next');
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('shows English at once and follows each change of language', async () => {
    stubCatalogs();
    const load = germanOnly();
    await loadPage({ demo: { translations: { en: ENGLISH, load } } });

    const { container } = render(<Label />);
    expect(container.textContent).toBe('Example plugin / Hello, Ada');

    await act(() => i18n.changeLanguage('de'));
    expect(container.textContent).toBe('Beispiel-Plugin / Hallo, Ada');

    // A language the plugin has no strings for shows its English.
    await act(() => i18n.changeLanguage('fr'));
    expect(container.textContent).toBe('Example plugin / Hello, Ada');
    expect(load.mock.calls).toEqual([['de'], ['fr']]);
  });

  it('shows the strings of a language that arrive after a component using them mounted', async () => {
    // The first load, in German: the app's catalog arrives first, the plugin's strings later.
    const catalogs = stubCatalogs({ held: true });
    const { load, release } = heldLoader();
    await loadPage({ demo: { translations: { en: ENGLISH, load } } }, 'de');

    const { container } = render(<Label />);
    catalogs.release();
    await settle();
    expect(i18n.t('nav.home')).toBe('Startseite');
    expect(container.textContent).toBe('Example plugin / Hello, Ada');

    release();
    await settle();
    expect(container.textContent).toBe('Beispiel-Plugin / Hallo, Ada');
  });

  it('translates outside React in the language in use when called', async () => {
    stubCatalogs();
    const load = germanOnly();
    await loadPage({ demo: { translations: { en: ENGLISH, load } } });
    const t = translations.getPluginTranslation('demo');

    expect(t('label')).toBe('Example plugin');
    // The keys are the plugin's own.
    expect(t('nav.home')).toBe('nav.home');
    // @ts-expect-error `t` gives text only.
    t('label', { returnObjects: true });
    await i18n.changeLanguage('de');
    expect(t('greeting.hello', { name: 'Ada' })).toBe('Hallo, Ada');
  });

  it('keeps English for a plugin without a loader, and registers no strings it cannot use', async () => {
    stubCatalogs();
    await loadPage({
      demo: { translations: { en: ENGLISH } },
      bad: { translations: { en: 'not strings', load: async () => GERMAN } },
      none: { messageRenderers: [] },
    });

    await i18n.changeLanguage('de');

    expect(translations.getPluginTranslation('demo')('label')).toBe('Example plugin');
    expect(i18n.hasResourceBundle('en', 'plugin.demo')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'plugin.bad')).toBe(false);
    expect(i18n.hasResourceBundle('en', 'plugin.none')).toBe(false);
  });

  it('registers no strings for a load whose address says ?plugins=off', async () => {
    stubCatalogs();
    window.history.replaceState(null, '', '/?plugins=off');
    await loadPage({ demo: { translations: { en: ENGLISH } } });

    expect(i18n.hasResourceBundle('en', 'plugin.demo')).toBe(false);
  });
});
