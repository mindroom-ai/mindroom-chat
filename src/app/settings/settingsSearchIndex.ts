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

// Lower case, and Latin letters without their accents, so "theme" finds "Thème". Other scripts
// keep their marks: an Indic vowel sign or a Japanese voicing mark changes the word.
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// The comma of each script, so every translation can list its words its own way.
const KEYWORD_SEPARATORS = /[,،、，;]/;

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
  const queryWords = fold(query).split(' ').filter(Boolean);
  if (queryWords.length === 0) return [];
  const text = (key: ParseKeys | undefined) => (key ? t(key, values) : '');
  const advanced = text('featureUi.settings.advanced');

  return settings
    .map((setting, order) => {
      const page = SETTINGS_PAGES.find((candidate) => candidate.id === setting.page);
      const label = text(setting.labelKey);
      const pageLabel = text(page?.labelKey);
      const groupLabel = text(setting.group);
      const fields: Fields = {
        label: fold(label),
        keywords: text(setting.keywordsKey).split(KEYWORD_SEPARATORS).map(fold).filter(Boolean),
        group: fold(groupLabel),
        description: fold(text(setting.descriptionKey)),
        page: fold(pageLabel),
      };
      const scores = queryWords.map((word) => scoreWord(word, fields));
      const exact = fields.label === queryWords.join(' ') ? WEIGHTS.labelStart : 0;
      const location = [pageLabel, groupLabel, setting.advanced ? advanced : '']
        .filter(Boolean)
        .filter((part, index, parts) => parts.indexOf(part) === index);
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
