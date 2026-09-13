export type AppLanguage = {
  code: string;
  // Shown untranslated in the language picker so every user can find
  // their own language regardless of the currently active one.
  nativeName: string;
};

export const APP_LANGUAGES: AppLanguage[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'nl', nativeName: 'Nederlands' },
];

export const APP_LANGUAGE_CODES: string[] = APP_LANGUAGES.map((language) => language.code);

export const DEFAULT_LANGUAGE_CODE = 'en';

export const toSupportedLanguageCode = (language: string | undefined): string => {
  if (!language) return DEFAULT_LANGUAGE_CODE;
  // Split on '_' as well as '-': POSIX-style codes (de_DE) can reach us via
  // the detector's querystring/localStorage sources even though BCP-47 uses hyphens.
  const baseCode = language.toLowerCase().split(/[-_]/)[0];
  return APP_LANGUAGE_CODES.includes(baseCode) ? baseCode : DEFAULT_LANGUAGE_CODE;
};
