import { AGENT_USERNAME_PREFIX, isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import {
  MATCH_SCORE,
  foldText,
  matchWord,
  originalRanges,
  prepareText,
  type PreparedText,
  type TextRange,
} from './fuzzyMatch';
import type {
  CommandPaletteActionItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';

// What an unread room or an open direct chat adds to a score: enough to go above an equal
// match, never above a better one.
const BOOST_WEIGHT = 3;
// Typed words a field holds together, in order, count a little more than the same words apart.
const PHRASE_BONUS = 2;

type SearchableCommandPaletteItem = {
  id: string;
  boost?: number;
  sortRank?: number;
};

/** One field a list is searched by. */
export type CommandPaletteSearchField<T> = {
  key: string;
  get: (item: T) => string | readonly string[] | undefined;
  /** The share of a match in this field that counts: 1 for what a row is called by. */
  weight: number;
  /** What a row is called by: it also matches by initials and by abbreviation. */
  name?: boolean;
  /**
   * What a row belongs to, such as its page: it matches a typed word only beside another word
   * that matches one of the row's other fields, so typing it alone does not list every such row.
   */
  context?: boolean;
};

export type CommandPaletteSearchConfig<T> = {
  fields: readonly CommandPaletteSearchField<T>[];
  limit: number;
  /** A typed word, folded, as the list's fields hold it; empty to leave the word out. */
  word?: (word: string) => string;
};

/** What matched in a row, by field key: ranges of the field's text as written. */
export type CommandPaletteMarks = Readonly<Record<string, readonly TextRange[]>>;

/** A row that matches typed text: how well (0 without text), and what to mark in it. */
export type CommandPaletteMatch<T> = { item: T; score: number; marks: CommandPaletteMarks };

type MatchCommandPaletteSectionOptions<T extends SearchableCommandPaletteItem> = {
  items: readonly T[];
  query: string;
  config: CommandPaletteSearchConfig<T>;
  /** Rows nothing matches follow the others, in the order given, with score 0. */
  keepUnmatched?: boolean;
};

const userName = ({ localpart }: CommandPaletteUserItem): string =>
  localpart.toLowerCase().startsWith(AGENT_USERNAME_PREFIX)
    ? localpart.slice(AGENT_USERNAME_PREFIX.length)
    : localpart;

/** A typed word as people's fields hold it: without the `@` of an ID and MindRoom's agent prefix. */
const personWord = (word: string): string => {
  const bare = word.startsWith('@') ? word.slice(1) : word;
  return bare.startsWith(AGENT_USERNAME_PREFIX) && bare.length > AGENT_USERNAME_PREFIX.length
    ? bare.slice(AGENT_USERNAME_PREFIX.length)
    : bare;
};

export const commandPaletteSearchConfig = {
  actions: {
    fields: [
      { key: 'title', get: (item) => item.title, weight: 1, name: true },
      { key: 'keywords', get: (item) => item.keywords, weight: 0.7 },
      { key: 'description', get: (item) => item.description, weight: 0.5 },
      // A choice's page or "Settings": "theme dracula" finds the theme, "theme" only the page.
      { key: 'tag', get: (item) => item.tag, weight: 0.5, context: true },
    ],
    limit: 6,
  } satisfies CommandPaletteSearchConfig<CommandPaletteActionItem>,
  rooms: {
    fields: [
      { key: 'name', get: (item) => item.name, weight: 1, name: true },
      { key: 'canonicalAlias', get: (item) => item.canonicalAlias, weight: 0.9 },
      { key: 'topic', get: (item) => item.topic, weight: 0.5 },
      { key: 'parentNames', get: (item) => item.parentNames, weight: 0.5 },
    ],
    limit: 8,
  } satisfies CommandPaletteSearchConfig<CommandPaletteRoomItem>,
  users: {
    fields: [
      { key: 'displayName', get: (item) => item.displayName, weight: 1, name: true },
      // Every agent's user name starts with MindRoom's prefix, which tells none of them apart.
      { key: 'userName', get: userName, weight: 0.8, name: true },
      {
        key: 'userId',
        get: (item) => (isMindroomAgentUserId(item.userId) ? undefined : item.userId),
        weight: 0.5,
      },
      {
        key: 'agentId',
        get: (item) =>
          isMindroomAgentUserId(item.userId)
            ? `@${userName(item)}${item.userId.slice(item.localpart.length + 1)}`
            : undefined,
        weight: 0.5,
      },
      { key: 'dmRoomName', get: (item) => item.dmRoomName, weight: 0.5 },
    ],
    limit: 6,
    word: personWord,
  } satisfies CommandPaletteSearchConfig<CommandPaletteUserItem>,
  threads: {
    fields: [
      // A thread's title is a sentence: its words are found, not its initials.
      { key: 'summaryText', get: (item) => item.summaryText, weight: 1 },
      { key: 'tags', get: (item) => item.tags, weight: 0.7 },
      { key: 'roomName', get: (item) => item.roomName, weight: 0.5 },
      { key: 'participantNames', get: (item) => item.participantNames, weight: 0.5 },
    ],
    limit: 8,
  } satisfies CommandPaletteSearchConfig<CommandPaletteThreadItem>,
};

/** One text of a row, prepared for the matcher. */
type RowText = {
  key: string;
  weight: number;
  name: boolean;
  context: boolean;
  prepared: PreparedText;
  /** The text as written, for a field that is one text; a list's entries are not marked. */
  written?: string;
};

type Row<T> = { item: T; texts: RowText[] };

// The prepared rows of a list, by the list and the fields it is searched by, for as long as the
// list keeps its identity.
const indexes = new WeakMap<object, WeakMap<object, Row<unknown>[]>>();

const prepareRows = <T>(
  items: readonly T[],
  fields: readonly CommandPaletteSearchField<T>[]
): Row<T>[] =>
  items.map((item) => ({
    item,
    texts: fields.flatMap(({ key, get, weight, name, context }): RowText[] => {
      const value = get(item);
      if (value === undefined) return [];
      const text = (written: string, single: boolean): RowText[] =>
        written
          ? [
              {
                key,
                weight,
                name: !!name,
                context: !!context,
                prepared: prepareText(written),
                written: single ? written : undefined,
              },
            ]
          : [];
      return typeof value === 'string'
        ? text(value, true)
        : value.flatMap((entry) => text(entry, false));
    }),
  }));

const getRows = <T>(
  items: readonly T[],
  fields: readonly CommandPaletteSearchField<T>[]
): Row<T>[] => {
  let byFields = indexes.get(items);
  if (!byFields) {
    byFields = new WeakMap();
    indexes.set(items, byFields);
  }
  const cached = byFields.get(fields);
  if (cached) return cached as Row<T>[];
  const rows = prepareRows(items, fields);
  byFields.set(fields, rows);
  return rows;
};

/** What a typed word, or the typed text as a whole, matched best: where, and how well. */
type Found = { text: RowText; score: number; ranges: readonly TextRange[] };

const findBest = (word: string, texts: readonly RowText[], own = false): Found | undefined => {
  let best: Found | undefined;
  texts.forEach((text) => {
    if (own && text.context) return;
    const match = matchWord(word, text.prepared, text.name);
    if (!match) return;
    const score = match.score * text.weight;
    if (!best || score > best.score) best = { text, score, ranges: match.ranges };
  });
  return best;
};

type Scored<T> = { item: T; score: number; found: Found[] };

const scoreRow = <T>(
  { item, texts }: Row<T>,
  words: readonly string[],
  phrase: string | undefined
): Scored<T> | undefined => {
  const found: Found[] = [];
  for (const word of words) {
    const best = findBest(word, texts);
    if (!best) return undefined;
    found.push(best);
  }
  if (found.every(({ text }) => text.context)) {
    // Every word matched only what the row belongs to: one of them has to match the row itself.
    let anchor: { index: number; found: Found } | undefined;
    words.forEach((word, index) => {
      const own = findBest(word, texts, true);
      if (own && (!anchor || own.score > anchor.found.score)) anchor = { index, found: own };
    });
    if (!anchor) return undefined;
    found[anchor.index] = anchor.found;
  }
  const score = found.reduce((sum, { score: part }) => sum + part, 0) / words.length;
  if (phrase) {
    // The typed words together, in order, in one field.
    const whole = findBest(phrase, texts, true);
    const wholeScore = whole && Math.min(MATCH_SCORE.exact, whole.score + PHRASE_BONUS);
    if (whole && wholeScore !== undefined && wholeScore > score) {
      return { item, score: wholeScore, found: [whole] };
    }
  }
  return { item, score, found };
};

const marksOf = (found: readonly Found[]): CommandPaletteMarks => {
  const folded = new Map<RowText, TextRange[]>();
  found.forEach(({ text, ranges }) => {
    if (text.written === undefined) return;
    folded.set(text, [...(folded.get(text) ?? []), ...ranges]);
  });
  const marks: Record<string, readonly TextRange[]> = {};
  folded.forEach((ranges, text) => {
    const sorted = [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    marks[text.key] = originalRanges(text.written ?? '', sorted);
  });
  return marks;
};

const compareId = (left: string, right: string): number => left.localeCompare(right);

/** The typed text as the words the lists are searched by. */
const typedWords = (query: string, word: ((word: string) => string) | undefined): string[] =>
  foldText(query)
    .split(/\s+/)
    .map((typed) => (word ? word(typed) : typed))
    .filter(Boolean);

/**
 * The rows of a list that match typed text, best first, up to the list's limit. Every typed word
 * has to match one of a row's fields; a row's score is the mean of its words' best matches, each
 * weighted by its field, or the match of the typed text as a whole where a field holds it so.
 * Equal scores keep the order of the rows' boost, then rank, then ID. Without text: the rows by
 * rank, boost and ID, with score 0 and no marks.
 */
export const matchCommandPaletteSection = <T extends SearchableCommandPaletteItem>({
  items,
  query,
  config,
  keepUnmatched = false,
}: MatchCommandPaletteSectionOptions<T>): CommandPaletteMatch<T>[] => {
  const words = typedWords(query, config.word);
  const unmarked = (item: T): CommandPaletteMatch<T> => ({ item, score: 0, marks: {} });

  if (words.length === 0) {
    return [...items]
      .sort(
        (left, right) =>
          (right.sortRank ?? 0) - (left.sortRank ?? 0) ||
          (right.boost ?? 0) - (left.boost ?? 0) ||
          compareId(left.id, right.id)
      )
      .slice(0, config.limit)
      .map(unmarked);
  }

  const phrase = words.length > 1 ? words.join(' ') : undefined;
  const scored: Scored<T>[] = [];
  const unmatched: T[] = [];
  getRows(items, config.fields).forEach((row) => {
    const result = scoreRow(row, words, phrase);
    if (result) scored.push(result);
    else if (keepUnmatched) unmatched.push(row.item);
  });

  const boosts = scored.map(({ item }) => item.boost ?? 0);
  const maxBoost = Math.max(...boosts, 0);
  const minBoost = Math.min(...boosts, 0);
  const boosted = ({ item, score }: Scored<T>): number =>
    maxBoost === minBoost
      ? score
      : score + (BOOST_WEIGHT * ((item.boost ?? 0) - minBoost)) / (maxBoost - minBoost);

  const matches = scored
    .map((entry) => ({ entry, order: boosted(entry) }))
    .sort(
      (left, right) =>
        right.order - left.order ||
        (right.entry.item.sortRank ?? 0) - (left.entry.item.sortRank ?? 0) ||
        compareId(left.entry.item.id, right.entry.item.id)
    )
    .slice(0, config.limit)
    .map(
      ({ entry }): CommandPaletteMatch<T> => ({
        item: entry.item,
        score: entry.score,
        marks: marksOf(entry.found),
      })
    );
  return [...matches, ...unmatched.map(unmarked)].slice(0, config.limit);
};

/** The items of {@link matchCommandPaletteSection}. */
export const searchCommandPaletteSection = <T extends SearchableCommandPaletteItem>(
  options: MatchCommandPaletteSectionOptions<T>
): T[] => matchCommandPaletteSection(options).map(({ item }) => item);
