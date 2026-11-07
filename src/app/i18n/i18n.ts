import i18n, {
  type BackendModule,
  type LanguageDetectorModule,
  type ReadCallback,
  type ResourceKey,
} from 'i18next';
import { initReactI18next } from 'react-i18next';
import en, { mergeLocaleTrees, type LocaleTree } from './englishResources';
import { loadLocaleAdditions } from './localeAdditions';
import { syncDayjsLocale } from './appLocale';
import {
  APP_LANGUAGE_CODES,
  DEFAULT_LANGUAGE_CODE,
  normalizeDetectedLanguage,
  toSupportedLanguageCode,
} from './i18nLanguages';
import { appUrl } from '../lib/basePath';
import { formatNumber, localDigits } from '../lib/localDigits';

// The language choice persists under the key i18next's browser detector
// uses, so existing installs keep their language.
const LANGUAGE_STORAGE_KEY = 'i18nextLng';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

// A catalog's name stays the same from one build to the next, and a deployment may let browsers
// keep files under public/ for a long time (MindRoom's client chart cached them as immutable for a
// year), so the URL names the build: the next build's page never reads an earlier build's copy
// from the browser's HTTP cache, the service worker or a proxy.
// The build version comes from the bundler's define, as in config/appVersion.ts, which this layer
// may not import.
declare const __MINDROOM_BUILD_VERSION__: string;
const BUILD_VERSION =
  typeof __MINDROOM_BUILD_VERSION__ === 'string' ? __MINDROOM_BUILD_VERSION__ : 'development-build';

const getLocaleUrl = (language: string): string =>
  `${appUrl(`public/locales/${encodeURIComponent(language)}.json`)}?v=${encodeURIComponent(
    BUILD_VERSION
  )}`;

const readStoredLanguage = (): string | undefined => {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const storeLanguage = (language: string): void => {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The language still applies for this page load.
  }
};

const browserLanguages = (): string[] => {
  if (typeof navigator === 'undefined') return [];
  const languages = Array.isArray(navigator.languages) ? [...navigator.languages] : [];
  if (navigator.language) languages.push(navigator.language);
  return languages;
};

/** Stored choice first, then the browser's preferences, normalized to app catalogs. */
const languageDetector: LanguageDetectorModule = {
  type: 'languageDetector',
  detect: () => {
    const candidates = [readStoredLanguage(), ...browserLanguages()].filter(
      (language): language is string => typeof language === 'string' && language.length > 0
    );
    const normalized = candidates.map(normalizeDetectedLanguage);
    return normalized.find((language) => APP_LANGUAGE_CODES.includes(language)) ?? normalized;
  },
  cacheUserLanguage: (language: string) => storeLanguage(language),
};

/** A registered namespace's strings in one language, or undefined when it has none. */
export type NamespaceLoader = (language: string) => Promise<LocaleTree | undefined>;

const namespaceLoaders = new Map<string, NamespaceLoader>();

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Fetches non-English catalogs from the deployed `public/locales/` directory on demand, with the
 * language's overlay of Lane C keys (locales/additions/<code>.json) merged in. A namespace added
 * with `registerNamespace` loads from its own loader instead.
 */
const httpBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read: (language: string, namespace: string, callback: ReadCallback) => {
    if (namespace !== 'translation') {
      // A language without strings keeps an empty bundle, so its loader is not asked again.
      Promise.resolve(language)
        .then((code) => namespaceLoaders.get(namespace)?.(code))
        .then(
          (strings) => callback(null, strings ?? {}),
          (error: unknown) => callback(toError(error), false)
        );
      return;
    }
    const additions = loadLocaleAdditions(language);
    fetch(getLocaleUrl(language), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) {
          callback(new Error(`Failed to load locale ${language}: HTTP ${response.status}`), false);
          return;
        }
        const catalog = (await response.json()) as LocaleTree;
        const overlay = await additions;
        callback(null, (overlay ? mergeLocaleTrees(catalog, overlay) : catalog) as ResourceKey);
      })
      .catch((error: unknown) => {
        callback(toError(error), false);
      });
  },
};

const applyDocumentLanguage = (language: string): void => {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const code = toSupportedLanguageCode(language);
  const [base = code] = code.split('-');
  document.documentElement.setAttribute('lang', code);
  document.documentElement.setAttribute('dir', RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr');
};

// The language asked for last. This i18next version applies each change of language once its loads
// finish, so an earlier change whose loads finish later would replace it: it is asked for again.
// An empty one asks the detector, as none does.
let requestedLanguage: string | undefined;

i18n.on('languageChanging', (language: string | undefined) => {
  requestedLanguage = language || undefined;
});

i18n.on('languageChanged', (language) => {
  const code = syncDayjsLocale(language);
  applyDocumentLanguage(code);
  if (requestedLanguage !== undefined && language !== requestedLanguage) {
    void i18n.changeLanguage(requestedLanguage);
  }
});

void i18n
  .use(httpBackend)
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LANGUAGE_CODE,
    supportedLngs: APP_LANGUAGE_CODES,
    // Keep regional catalogs such as zh-TW instead of reducing them to zh.
    nonExplicitSupportedLngs: false,
    load: 'currentOnly',
    // English ships in the bundle; i18next loads only missing languages from the backend.
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    interpolation: {
      escapeValue: false,
      // A number reads in the language's own digits wherever a translation puts it, as the dates
      // and times Intl formats do (Bengali writes ০ to ৯); `{{count, number}}` also groups
      // thousands. Other values (names, typed as strings here) pass through unchanged.
      alwaysFormat: true,
      format: (value: string | number, format?: string, language?: string): string => {
        if (typeof value !== 'number') return value;
        return format === 'number'
          ? formatNumber(value, language)
          : localDigits(String(value), language);
      },
    },
    react: { useSuspense: false },
    returnNull: false,
  });

/**
 * Adds a namespace beside the app's own catalog, such as a plugin's `plugin.<id>`: its English
 * strings apply at once, and `load` gives another language's strings while that language is in use.
 * Register it before anything loads the namespace, such as `useTranslation` with it: a language
 * loaded earlier keeps showing English. Resolves once the strings of the language in use, or of the
 * one being switched to, have loaded.
 */
export const registerNamespace = async (
  namespace: string,
  english: LocaleTree,
  load: NamespaceLoader
): Promise<void> => {
  namespaceLoaders.set(namespace, load);
  i18n.addResourceBundle('en', namespace, english);
  const loading = i18n.loadNamespaces(namespace);
  // A change of language under way loads only the namespaces it started with.
  if (requestedLanguage !== undefined && requestedLanguage !== i18n.language) {
    await i18n.changeLanguage(requestedLanguage);
  }
  await loading;
};

export default i18n;
