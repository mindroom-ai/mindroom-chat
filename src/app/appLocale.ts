import dayjs from 'dayjs';
import 'dayjs/locale/de';
import 'dayjs/locale/en';
import 'dayjs/locale/nl';
import { toSupportedLanguageCode } from './i18nLanguages';

export const syncDayjsLocale = (language: string | undefined): string => {
  const languageCode = toSupportedLanguageCode(language);
  dayjs.locale(languageCode);
  return languageCode;
};
