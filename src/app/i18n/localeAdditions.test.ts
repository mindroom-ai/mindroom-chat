import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocaleTree } from './englishResources';
import { APP_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE } from './i18nLanguages';
import { loadLocaleAdditions } from './localeAdditions';
import enAdditions from './locales/additions/en.json';

const LOCALES_DIR = fileURLToPath(new URL('./locales/', import.meta.url));
const ADDITIONS_DIR = `${LOCALES_DIR}additions/`;

const readTree = (path: string): LocaleTree => JSON.parse(readFileSync(path, 'utf8'));

const leaves = (tree: LocaleTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [[path, value]] : leaves(value, path);
  });

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const logicalKey = (path: string): string => path.replace(PLURAL_SUFFIX, '');

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map(([, name = '']) => name.replace(/\s+/g, ''))
    .sort();

const markupTags = (value: string): string[] =>
  [...value.matchAll(/<\/?[A-Za-z][^>]*>/g)].map((match) => match[0].replace(/\s+/g, '')).sort();

// Names and protocol words that stay as they are in every language.
const LITERAL_TOKENS = ['MindRoom', 'Matrix', 'JSON'];

const english = new Map(leaves(enAdditions));
const englishKeys = [...new Set([...english.keys()].map(logicalKey))];
const englishPlurals = new Set(
  [...english.keys()].filter((path) => PLURAL_SUFFIX.test(path)).map(logicalKey)
);
const sourceText = (path: string): string | undefined =>
  english.get(path) ?? english.get(`${logicalKey(path)}_other`);

const overlayCodes = readdirSync(ADDITIONS_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .filter((code) => code !== DEFAULT_LANGUAGE_CODE);

describe('language overlays (locales/additions/<code>.json)', () => {
  it('exist for every app language besides English, and only for app languages', () => {
    expect([...overlayCodes].sort()).toEqual(
      APP_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE_CODE).sort()
    );
  });

  describe.each(overlayCodes)('%s', (code) => {
    const overlay = readTree(`${ADDITIONS_DIR}${code}.json`);
    const values = new Map(leaves(overlay));
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

    it("has exactly the English overlay's keys, with this language's plural categories", () => {
      const expected = englishKeys.flatMap((path) =>
        englishPlurals.has(path) ? categories.map((category) => `${path}_${category}`) : [path]
      );
      expect([...values.keys()].sort()).toEqual(expected.sort());
    });

    it("keeps the English text's placeholders, markup and literal names", () => {
      values.forEach((value, path) => {
        const source = sourceText(path);
        expect(source, path).toBeDefined();
        if (source === undefined) return;
        expect(placeholders(value), path).toEqual(placeholders(source));
        expect(markupTags(value), path).toEqual(markupTags(source));
        const bare = value.replace(/[\u2068\u2069]/g, '');
        LITERAL_TOKENS.filter((token) => source.includes(token)).forEach((token) =>
          expect(bare, `${path} -> ${token}`).toContain(token)
        );
        for (const shortcode of source.matchAll(/:\{\{\s*[^}]+?\s*\}\}:/g)) {
          expect(bare, path).toContain(shortcode[0]);
        }
      });
    });

    it('has no empty text', () => {
      values.forEach((value, path) => expect(value.trim(), path).not.toBe(''));
    });

    it('adds only keys that the ported catalog of the language lacks', () => {
      const ported = new Set(leaves(readTree(`${LOCALES_DIR}${code}.json`)).map(([p]) => p));
      values.forEach((_value, path) => expect(ported.has(path), path).toBe(false));
    });

    it('is what the app loads for the language', async () => {
      expect(await loadLocaleAdditions(code)).toEqual(overlay);
    });

    it.runIf(code === 'ar')('isolates every placeholder from the right-to-left text', () => {
      values.forEach((value, path) => {
        for (const match of value.matchAll(/\{\{[^}]+\}\}/g)) {
          const before = value[match.index - 1];
          const after = value[match.index + match[0].length];
          // A placeholder on a line of its own is a paragraph of its own, with no text to mix.
          if ([before, after].every((side) => side === undefined || side === '\n')) continue;
          expect(before, path).toBe('\u2068');
          expect(after, path).toBe('\u2069');
        }
      });
    });
  });

  it('has none for English, whose overlay ships in the bundle', async () => {
    expect(await loadLocaleAdditions(DEFAULT_LANGUAGE_CODE)).toBeUndefined();
    expect(await loadLocaleAdditions('xx')).toBeUndefined();
  });
});

describe('i18n backend with a language overlay', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges the overlay into the fetched catalog, whose own keys keep their text', async () => {
    const fetched = {
      settings: { general: { language: { appLanguage: 'Sprache der App' } } },
      sharedUi: { passwordInput: { show: 'Aus dem Katalog' } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(fetched), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    const german = readTree(`${ADDITIONS_DIR}de.json`);
    const germanText = new Map(leaves(german));

    const { default: i18n } = await import('./i18n');
    if (!i18n.isInitialized) {
      await new Promise<void>((resolve) => {
        i18n.on('initialized', () => resolve());
      });
    }
    await i18n.changeLanguage('de');

    expect(i18n.t('settings.general.language.appLanguage')).toBe('Sprache der App');
    expect(i18n.t('sharedUi.passwordInput.show')).toBe('Aus dem Katalog');
    expect(i18n.t('sharedUi.passwordInput.hide')).toBe(
      germanText.get('sharedUi.passwordInput.hide')
    );
    expect(i18n.t('mindroomUi.notifications.invitation.body', { count: 3 })).toBe(
      germanText.get('mindroomUi.notifications.invitation.body_other')?.replace('{{count}}', '3')
    );
  });
});
