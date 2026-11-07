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
import { APP_BUILD_VERSION } from '../config/appVersion';
import { formatNumber, localDigits } from '../lib/localDigits';

// The language choice persists under the key i18next's browser detector
// uses, so existing installs keep their language.
const LANGUAGE_STORAGE_KEY = 'i18nextLng';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

// A catalog's name stays the same from one build to the next, and a deployment may let browsers
// keep files under public/ for a long time (MindRoom's client chart cached them as immutable for a
// year), so the URL names the build: the next build's page never reads an earlier build's copy
// from the browser's HTTP cache, the service worker or a proxy.
const getLocaleUrl = (language: string): string =>
  `${appUrl(`public/locales/${encodeURIComponent(language)}.json`)}?v=${encodeURIComponent(
    APP_BUILD_VERSION
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

/**
 * Fetches non-English catalogs from the deployed `public/locales/` directory on demand, with the
 * language's overlay of Lane C keys (locales/additions/<code>.json) merged in.
 */
const httpBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read: (language: string, _namespace: string, callback: ReadCallback) => {
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
        callback(error instanceof Error ? error : new Error(String(error)), false);
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

i18n.on('languageChanged', (language) => {
  const code = syncDayjsLocale(language);
  applyDocumentLanguage(code);
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

export default i18n;
