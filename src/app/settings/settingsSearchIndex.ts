import type { ParseKeys } from 'i18next';
import { SETTINGS_PAGES, type SettingDefinition } from '../preferences/settingsRegistry';

/** A setting that matches the query, with the text the result list shows. */
export type SettingsSearchResult = {
  setting: SettingDefinition;
  label: string;
  /** Where the setting lives: its page, its group on the page, and the Advanced fold. */
  location: string[];
};

/** Values for the placeholders some labels hold (the user ID in "Mention User ID", ...). */
export type SettingsSearchValues = Record<string, string>;

/** The active language's text for a key. */
export type SettingsTranslate = (key: ParseKeys, values?: SettingsSearchValues) => string;

/**
 * Text as the search compares it: lower case, one space between words, and Latin letters without
 * their accents, so "theme" finds "Thème". Other scripts keep their marks: an Indic vowel sign or
 * a Japanese voicing mark changes the word.
 */
export const foldSearchText = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// The comma of each script, so every translation can list its words its own way.
const KEYWORD_SEPARATORS = /[,،、，;]/;

/** A setting's text in the active language: what its search and its rows elsewhere show. */
export type SettingText = {
  label: string;
  /** Empty when the setting has none. */
  description: string;
  keywords: string[];
  /** Where the setting lives: its page, its group on the page, and the Advanced fold. */
  location: string[];
};

const translator =
  (t: SettingsTranslate, values: SettingsSearchValues) =>
  (key: ParseKeys | undefined): string =>
    key ? t(key, values) : '';

// The labels of the page and of the group on it that hold a setting; a missing one is empty.
const placeLabels = (setting: SettingDefinition, text: ReturnType<typeof translator>) => ({
  page: text(SETTINGS_PAGES.find((candidate) => candidate.id === setting.page)?.labelKey),
  group: text(setting.group),
});

/**
 * The text of `setting` as its page shows it, with the placeholders of `values` filled in: the
 * search words split at the language's commas, and the location without a part that repeats.
 */
export const getSettingText = (
  setting: SettingDefinition,
  t: SettingsTranslate,
  values: SettingsSearchValues = {}
): SettingText => {
  const text = translator(t, values);
  const { page, group } = placeLabels(setting, text);
  return {
    label: text(setting.labelKey),
    description: text(setting.descriptionKey),
    keywords: text(setting.keywordsKey)
      .split(KEYWORD_SEPARATORS)
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    location: [page, group, setting.advanced ? text('featureUi.settings.advanced') : '']
      .filter(Boolean)
      .filter((part, index, parts) => parts.indexOf(part) === index),
  };
};

const words = (text: string): string[] => text.split(/[^\p{L}\p{N}@]+/u).filter(Boolean);

/** How well one query word fits each field; the best field counts. */
const WEIGHTS = {
  labelStart: 100,
  labelWord: 80,
  label: 60,
  keywordStart: 50,
  keyword: 40,
  group: 25,
  description: 20,
  page: 10,
} as const;

type Fields = {
  label: string;
  keywords: string[];
  group: string;
  description: string;
  page: string;
};

const scoreWord = (word: string, fields: Fields): number => {
  const { label, keywords, group, description, page } = fields;
  if (label.startsWith(word)) return WEIGHTS.labelStart;
  if (words(label).some((part) => part.startsWith(word))) return WEIGHTS.labelWord;
  if (label.includes(word)) return WEIGHTS.label;
  if (keywords.some((keyword) => keyword.startsWith(word))) return WEIGHTS.keywordStart;
  if (keywords.some((keyword) => keyword.includes(word))) return WEIGHTS.keyword;
  if (group.includes(word)) return WEIGHTS.group;
  if (description.includes(word)) return WEIGHTS.description;
  if (page.includes(word)) return WEIGHTS.page;
  return 0;
};

/**
 * The settings that match `query` in the active language, best first: every word of the query
 * has to appear in the label, keywords, group, description or page name. A label that starts
 * with a word beats one that holds it, which beats a keyword, and so on down to the page name;
 * equal scores keep the registry's order.
 */
export const searchSettings = (
  query: string,
  settings: readonly SettingDefinition[],
  t: SettingsTranslate,
  values: SettingsSearchValues = {}
): SettingsSearchResult[] => {
  const queryWords = foldSearchText(query).split(' ').filter(Boolean);
  if (queryWords.length === 0) return [];
  const text = translator(t, values);

  return settings
    .map((setting, order) => {
      const { label, description, keywords, location } = getSettingText(setting, t, values);
      // The group counts even where the location leaves it out for repeating the page's name.
      const { page, group } = placeLabels(setting, text);
      const fields: Fields = {
        label: foldSearchText(label),
        keywords: keywords.map(foldSearchText).filter(Boolean),
        group: foldSearchText(group),
        description: foldSearchText(description),
        page: foldSearchText(page),
      };
      const scores = queryWords.map((word) => scoreWord(word, fields));
      const exact = fields.label === queryWords.join(' ') ? WEIGHTS.labelStart : 0;
      return {
        result: { setting, label, location },
        score: scores.includes(0) ? 0 : scores.reduce((sum, score) => sum + score, exact),
        order,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ result }) => result);
};
