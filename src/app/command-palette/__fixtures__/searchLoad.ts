import type { CommandPaletteRoomItem, CommandPaletteUserItem } from '../commandPaletteTypes';

const WORDS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'omega',
  'platform',
  'design',
  'engineering',
  'support',
  'customer',
  'release',
  'planning',
  'roadmap',
  'weekly',
  'sync',
  'data',
  'science',
  'backend',
  'frontend',
  'mobile',
  'café',
  'zürich',
  'münchen',
  'office',
  'team',
  'project',
  'review',
  'incident',
  'security',
  'finance',
  'legal',
  'marketing',
  'sales',
  'research',
  'archive',
  '東京',
  'オフィス',
  'москва',
  'офис',
  'general',
  'random',
  'social',
  'announce',
  'help',
];

const FIRST_NAMES = [
  'John',
  'Johnny',
  'Jon',
  'Joan',
  'Johan',
  'Lisa',
  'Elisa',
  'Emma',
  'Emmanuel',
  'José',
  'Zoë',
  'Søren',
  'Łukasz',
  'François',
  'Anna',
  'Anne',
  'Anton',
  'Alice',
  'Bob',
  'Chris',
  'Christina',
  'Maria',
  'Мария',
  'Peter',
  'Laura',
  'David',
  'Linda',
  'Karen',
  'Paula',
  'Nina',
  '太郎',
  '花子',
];

const LAST_NAMES = [
  'Smith',
  'Snow',
  'Müller',
  'Schmidt',
  'Simpson',
  'Watson',
  'García',
  'Kowalski',
  'Dupont',
  'Lee',
  'Johnson',
  'Stone',
  'Evans',
  'Nolan',
  'Иванова',
  '田中',
  'Nilsson',
  'Arendt',
  'Clarke',
];

// A fixed sequence, so every run searches the same lists.
const sequence = (seed: number) => {
  let state = seed;
  return (bound: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % bound;
  };
};

const pick = (list: readonly string[], next: (bound: number) => number): string =>
  list[next(list.length)] ?? '';

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** `count` rooms with names of two or three words, a topic, an alias and a parent, as an account with many rooms holds. */
export const makeLoadRooms = (count: number): CommandPaletteRoomItem[] => {
  const next = sequence(7);
  return Array.from({ length: count }, (_, index): CommandPaletteRoomItem => {
    const words = Array.from({ length: 2 + next(2) }, () => pick(WORDS, next));
    return {
      id: `room:${index}`,
      kind: 'room',
      name: words.map(capitalize).join(' '),
      canonicalAlias: `#${words.join('-')}-${index}:example.org`,
      topic: Array.from({ length: 6 }, () => pick(WORDS, next)).join(' '),
      parentNames: [capitalize(pick(WORDS, next))],
      sortRank: count - index,
      boost: next(4) === 0 ? 15 : 0,
    };
  });
};

/** `count` people with a first and a last name. */
export const makeLoadUsers = (count: number): CommandPaletteUserItem[] => {
  const next = sequence(11);
  return Array.from({ length: count }, (_, index): CommandPaletteUserItem => {
    const first = pick(FIRST_NAMES, next);
    const last = pick(LAST_NAMES, next);
    const localpart = `user${index}`;
    return {
      id: `user:${index}`,
      kind: 'user',
      displayName: `${first} ${last}`,
      userId: `@${localpart}:example.org`,
      localpart,
      boost: next(10) === 0 ? 10 : 0,
    };
  });
};

/** What a person types, a letter at a time: every start of each text. */
export const LOAD_QUERIES = [
  'platform',
  'john smith',
  'enginering',
  'crm',
  'zurich',
  '東京',
].flatMap((text) => Array.from(text, (_, index) => text.slice(0, index + 1)));
