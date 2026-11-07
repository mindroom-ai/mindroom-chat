import { normalizeSearchString } from '../lib/hooks/useAsyncSearch';
import { mentionRank } from '../editor/autocomplete/mentionRanking';

// Rows the fuzzy search found without a match mentionRank counts (a typo) come after the others.
const UNRANKED = Number.MAX_SAFE_INTEGER;

const rankPerson = (item: object, needle: string): number => {
  if (!('userId' in item) || typeof item.userId !== 'string') return UNRANKED;
  const name =
    'displayName' in item && typeof item.displayName === 'string' ? item.displayName : '';
  return mentionRank({ userId: item.userId, rawDisplayName: name, name }, needle) ?? UNRANKED;
};

/**
 * The palette's people in the order of how well they match the typed `query`, as mention
 * autocomplete ranks members: the whole display name, its start, the start of a later word, then
 * the user name and user ID, and text inside them last. Equal matches keep the order they came
 * in, so an existing direct chat or a shared room only breaks ties: typing someone's full name
 * never puts another person, whose chat Enter would open, above them.
 */
export const rankCommandPalettePeople = <T extends object>(
  people: readonly T[],
  query: string
): T[] => {
  const needle = normalizeSearchString(query.replace(/^\s*@/, ''));
  if (!needle) return [...people];
  return people
    .map((item, index) => ({ item, index, rank: rankPerson(item, needle) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
};
