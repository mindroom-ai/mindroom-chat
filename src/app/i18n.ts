import i18n, {
  type BackendModule,
  type LanguageDetectorModule,
  type ReadCallback,
  type ResourceKey,
} from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import { syncDayjsLocale } from './appLocale';
import {
  APP_LANGUAGE_CODES,
  DEFAULT_LANGUAGE_CODE,
  normalizeDetectedLanguage,
  toSupportedLanguageCode,
} from './i18nLanguages';
import { appUrl } from './utils/basePath';

// The language choice persists under the key i18next's browser detector
// uses, so existing installs keep their language.
export const LANGUAGE_STORAGE_KEY = 'i18nextLng';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export const getLocaleUrl = (language: string): string =>
  appUrl(`public/locales/${encodeURIComponent(language)}.json`);

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

/** Fetches non-English catalogs from the deployed `public/locales/` directory on demand. */
const httpBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read: (language: string, _namespace: string, callback: ReadCallback) => {
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
        callback(null, (await response.json()) as ResourceKey);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), false);
      });
  },
};

const applyDocumentLanguage = (language: string): void => {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const code = toSupportedLanguageCode(language);
  const base = code.split('-')[0];
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
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnNull: false,
  });

export default i18n;
