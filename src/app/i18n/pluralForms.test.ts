import { readFileSync } from 'fs';
import { createInstance } from 'i18next';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { mergeLocaleTrees, type LocaleTree } from './englishResources';

// i18next picks a counted string's form with Intl.PluralRules (`_zero` to `_other`). These
// tests check the forms themselves in the two app languages with more than two of them:
// Arabic (dual for 2, plural noun for 3 to 10) and Russian (2 to 4 apart from 5 and more).

const LOCALES_DIR = fileURLToPath(new URL('./locales', import.meta.url));
const read = (file: string): LocaleTree =>
  JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as LocaleTree;
const catalog = (code: string): LocaleTree =>
  mergeLocaleTrees(read(`${code}.json`), read(`additions/${code}.json`));

const leaves = (tree: LocaleTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [[path, value]] : leaves(value, path);
  });

/** A counted string's text by plural category (zero, one, two, few, many, other). */
type Forms = Record<string, string>;

/** Each counted string's forms, by the key without its plural suffix. */
const pluralGroups = (tree: LocaleTree): Map<string, Forms> => {
  const groups = new Map<string, Forms>();
  leaves(tree).forEach(([path, value]) => {
    const [, key, category] = /^(.*)_(zero|one|two|few|many|other)$/.exec(path) ?? [];
    if (key === undefined || category === undefined) return;
    groups.set(key, { ...groups.get(key), [category]: value });
  });
  return groups;
};

const english = pluralGroups(catalog('en'));

/**
 * The counted strings of `code` that name what they count: English gives them two forms, and
 * the language words them differently for different numbers (a wording such as "Selected: 3"
 * reads the same for every number and has nothing to check).
 */
const countedNouns = (code: string): Array<[string, Forms]> =>
  [...pluralGroups(catalog(code))].filter(([key, forms]) => {
    const source = english.get(key);
    return source?.one !== source?.other && new Set(Object.values(forms)).size > 1;
  });

const sameForms = (
  code: string,
  pairs: Array<[string, string]>,
  allowed: string[] = []
): string[] =>
  countedNouns(code).flatMap(([key, forms]) =>
    pairs
      .filter(([a, b]) => forms[a] === forms[b] && !allowed.includes(key))
      .map(([a, b]) => `${key}: ${a} is ${b} ("${forms[a]}")`)
  );

describe('plural forms', () => {
  it('Arabic gives 2 its dual and 3 to 10 their plural noun', () => {
    expect(
      sameForms('ar', [
        ['few', 'one'],
        ['two', 'few'],
        ['two', 'one'],
      ])
    ).toEqual([]);
  });

  it('Russian words 2 to 4 apart from 5 and more', () => {
    // After "Сводка" the whole number phrase is genitive, where 2 to 4 read like 5 and more.
    expect(sameForms('ru', [['few', 'many']], ['sharedUi.threadSummary.provenanceCount'])).toEqual(
      []
    );
  });

  it('resolves the counts the live test saw', async () => {
    const instance = createInstance();
    await instance.init({
      lng: 'ar',
      fallbackLng: 'en',
      resources: {
        en: { translation: catalog('en') },
        ar: { translation: catalog('ar') },
        ru: { translation: catalog('ru') },
      },
      interpolation: { escapeValue: false },
    });
    const ar = instance.getFixedT('ar');
    const ru = instance.getFixedT('ru');
    const plain = (text: string) => text.replace(/[⁨⁩]/g, '');
    expect(plain(ar('commandPalette.resultCount', { count: 8 }))).toBe('8 نتائج');
    expect(plain(ar('thread.stats.threadCount', { count: 5 }))).toBe('5 سلاسل محادثة');
    expect(plain(ar('thread.replyCount', { count: 2 }))).toBe('ردّان (2)');
    expect(plain(ar('thread.replyCount', { count: 12 }))).toBe('12 ردًا');
    expect(ru('commandPalette.resultCount', { count: 3 })).toBe('3 результата');
    expect(ru('commandPalette.resultCount', { count: 5 })).toBe('5 результатов');
    expect(ru('thread.stats.threadCount', { count: 2 })).toBe('2 ветки');
  });
});
