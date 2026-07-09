export type AppLanguage = {
  code: string;
  // Shown untranslated in the language picker so every user can find
  // their own language regardless of the currently active one.
  nativeName: string;
};

export const APP_LANGUAGES: AppLanguage[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'de', nativeName: 'Deutsch' },
];

export const APP_LANGUAGE_CODES: string[] = APP_LANGUAGES.map((language) => language.code);

export const DEFAULT_LANGUAGE_CODE = 'en';

export const toSupportedLanguageCode = (language: string | undefined): string => {
  if (!language) return DEFAULT_LANGUAGE_CODE;
  const baseCode = language.toLowerCase().split('-')[0];
  return APP_LANGUAGE_CODES.includes(baseCode) ? baseCode : DEFAULT_LANGUAGE_CODE;
};
