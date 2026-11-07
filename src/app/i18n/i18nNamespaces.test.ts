import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocaleTree } from './englishResources';

// A namespace registered beside the app's own catalog, as a plugin registers `plugin.<id>`: its
// English strings ship with its code, and every other language's come from its loader when that
// language is in use. The app's own catalogs come from the deployment (fetch, stubbed here).
const NAMESPACE = 'plugin.demo';
const ENGLISH = { greeting: 'Hello', farewell: 'Goodbye' };

const CATALOGS: Record<string, LocaleTree> = {
  de: { nav: { home: 'Startseite' } },
  fr: { nav: { home: 'Accueil' } },
};

/** Serves the app's catalogs; a language in `held` answers only once `release` is called for it. */
const stubCatalogs = (held: string[] = []) => {
  const releases = new Map<string, () => void>();
  const fetchMock = vi.fn(async (url: string) => {
    const language = /\/locales\/([\w-]+)\.json/.exec(url)?.[1] ?? '';
    if (held.includes(language)) {
      await new Promise<void>((resolve) => releases.set(language, resolve));
    }
    return new Response(JSON.stringify(CATALOGS[language] ?? {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, release: (language: string) => releases.get(language)?.() };
};

describe('registered i18n namespaces', () => {
  let i18n: typeof import('./i18n').default;
  let registerNamespace: typeof import('./i18n').registerNamespace;

  // The app's typed keys cover its own catalog only.
  const translate = (key: string): string => i18n.t(`${NAMESPACE}:${key}` as never);

  beforeEach(async () => {
    vi.resetModules();
    // i18next keeps one instance for the process, which a fresh import of the setup would share:
    // each test sets up its own.
    vi.doMock('i18next', async (importOriginal) => {
      const actual = await importOriginal<typeof import('i18next')>();
      return { ...actual, default: actual.default.createInstance() };
    });
    // The runtime starts in English whatever language the machine running the tests prefers.
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
    ({ default: i18n, registerNamespace } = await import('./i18n'));
  });

  afterEach(() => {
    vi.doUnmock('i18next');
    vi.unstubAllGlobals();
  });

  it('shows English at once and another language from its loader, asked once per language', async () => {
    const { fetchMock } = stubCatalogs();
    const load = vi.fn(async (language: string) =>
      language === 'de' ? { greeting: 'Hallo' } : undefined
    );

    void registerNamespace(NAMESPACE, ENGLISH, load);
    expect(translate('greeting')).toBe('Hello');

    await i18n.changeLanguage('de');
    expect(translate('greeting')).toBe('Hallo');
    expect(translate('farewell')).toBe('Goodbye');

    await i18n.changeLanguage('fr');
    expect(translate('greeting')).toBe('Hello');

    await i18n.changeLanguage('de');
    await i18n.changeLanguage('fr');
    expect(load.mock.calls).toEqual([['de'], ['fr']]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/public/locales/de.json?v=development-build',
      '/public/locales/fr.json?v=development-build',
    ]);
  });

  it('loads a namespace registered after a change of language for that language', async () => {
    stubCatalogs();
    await i18n.changeLanguage('de');
    const changes = vi.fn();
    i18n.on('languageChanged', changes);

    await registerNamespace(NAMESPACE, ENGLISH, async () => ({ greeting: 'Hallo' }));
    i18n.off('languageChanged', changes);

    expect(translate('greeting')).toBe('Hallo');
    expect(changes).not.toHaveBeenCalled();
  });

  it('loads a namespace registered during a change of language for the new language', async () => {
    const { release } = stubCatalogs(['de']);

    const switching = i18n.changeLanguage('de');
    const registering = registerNamespace(NAMESPACE, ENGLISH, async (language) =>
      language === 'de' ? { greeting: 'Hallo' } : undefined
    );
    release('de');
    await Promise.all([switching, registering]);

    expect(i18n.language).toBe('de');
    expect(translate('greeting')).toBe('Hallo');
  });

  it('keeps the language picked last when the app catalog of an earlier pick arrives later', async () => {
    const { release } = stubCatalogs(['de']);

    const toGerman = i18n.changeLanguage('de');
    await i18n.changeLanguage('fr');
    expect(i18n.t('nav.home')).toBe('Accueil');
    release('de');
    await toGerman;

    expect(i18n.language).toBe('fr');
    expect(i18n.t('nav.home')).toBe('Accueil');
  });

  it('keeps the language picked last when the namespace of an earlier pick arrives later', async () => {
    stubCatalogs();
    let releaseGerman: (strings: LocaleTree) => void = () => undefined;
    const load = vi.fn((language: string) =>
      language === 'de'
        ? new Promise<LocaleTree>((resolve) => {
            releaseGerman = resolve;
          })
        : Promise.resolve({ greeting: 'Bonjour' })
    );
    await registerNamespace(NAMESPACE, ENGLISH, load);

    const toGerman = i18n.changeLanguage('de');
    await i18n.changeLanguage('fr');
    expect(translate('greeting')).toBe('Bonjour');
    releaseGerman({ greeting: 'Hallo' });
    await toGerman;

    expect(i18n.language).toBe('fr');
    expect(translate('greeting')).toBe('Bonjour');
    // The late strings stay German: picking German now shows them without asking again.
    await i18n.changeLanguage('de');
    expect(translate('greeting')).toBe('Hallo');
    expect(load.mock.calls).toEqual([['de'], ['fr']]);
  });

  it('shows English for a language whose loader fails', async () => {
    stubCatalogs();
    await registerNamespace(NAMESPACE, ENGLISH, () => {
      throw new Error('offline');
    });

    await i18n.changeLanguage('de');

    expect(i18n.t('nav.home')).toBe('Startseite');
    expect(translate('greeting')).toBe('Hello');
  });
});
