import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  APP_LANGUAGES,
  APP_LANGUAGE_CODES,
  DEFAULT_LANGUAGE_CODE,
  toSupportedLanguageCode,
} from './i18nLanguages';

const LOCALES_DIR = fileURLToPath(new URL('./locales', import.meta.url));

type LocaleTree = { [key: string]: string | LocaleTree };

const readLocale = (code: string): LocaleTree =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8'));

const collectEntries = (tree: LocaleTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [[path, value]] : collectEntries(value, path);
  });

const collectKeyPaths = (tree: LocaleTree): string[] => collectEntries(tree).map(([path]) => path);

const interpolationPlaceholders = (value: string): string[] =>
  [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

const collectLeafValues = (tree: LocaleTree): string[] =>
  Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : collectLeafValues(value)
  );

const localeFileCodes = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''));

describe('app languages', () => {
  it('registers the default language', () => {
    expect(APP_LANGUAGE_CODES).toContain(DEFAULT_LANGUAGE_CODE);
  });

  it('has a locale file for every registered language', () => {
    APP_LANGUAGES.forEach((language) => {
      expect(localeFileCodes, `missing src/app/locales/${language.code}.json`).toContain(
        language.code
      );
    });
  });

  it('registers every locale file as a selectable language', () => {
    localeFileCodes.forEach((code) => {
      expect(APP_LANGUAGE_CODES, `src/app/locales/${code}.json is not in APP_LANGUAGES`).toContain(
        code
      );
    });
  });
});

describe('locale files', () => {
  const enKeyPaths = collectKeyPaths(readLocale(DEFAULT_LANGUAGE_CODE)).sort();

  localeFileCodes
    .filter((code) => code !== DEFAULT_LANGUAGE_CODE)
    .forEach((code) => {
      it(`${code}.json covers exactly the same keys as en.json`, () => {
        expect(collectKeyPaths(readLocale(code)).sort()).toEqual(enKeyPaths);
      });

      it(`${code}.json uses the same interpolation placeholders as en.json`, () => {
        const enValues = new Map(collectEntries(readLocale(DEFAULT_LANGUAGE_CODE)));
        collectEntries(readLocale(code)).forEach(([path, value]) => {
          const enValue = enValues.get(path);
          if (enValue === undefined) return;
          expect(interpolationPlaceholders(value), path).toEqual(
            interpolationPlaceholders(enValue)
          );
        });
      });
    });

  localeFileCodes.forEach((code) => {
    it(`${code}.json has no empty translations`, () => {
      collectLeafValues(readLocale(code)).forEach((value) => {
        expect(value.trim()).not.toBe('');
      });
    });
  });
});

describe('toSupportedLanguageCode', () => {
  it('keeps supported codes', () => {
    expect(toSupportedLanguageCode('de')).toBe('de');
  });

  it('reduces regional variants to their base language', () => {
    expect(toSupportedLanguageCode('de-AT')).toBe('de');
    expect(toSupportedLanguageCode('de_AT')).toBe('de');
    expect(toSupportedLanguageCode('EN-US')).toBe('en');
    expect(toSupportedLanguageCode('EN_US')).toBe('en');
    expect(toSupportedLanguageCode('nl-BE')).toBe('nl');
  });

  it('falls back to the default language for unsupported or missing codes', () => {
    expect(toSupportedLanguageCode('fr')).toBe(DEFAULT_LANGUAGE_CODE);
    expect(toSupportedLanguageCode(undefined)).toBe(DEFAULT_LANGUAGE_CODE);
    expect(toSupportedLanguageCode('')).toBe(DEFAULT_LANGUAGE_CODE);
  });
});
