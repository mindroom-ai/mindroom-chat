import { describe, expect, it } from 'vitest';
import { RECENT_VISIT_PINS, withRecentVisits } from './commandPaletteRecentVisits';
import { matchCommandPaletteSection } from './commandPaletteSearch';

// Rows as the palette builds them: ranked by activity, the open one (`e`) at rank 0.
const rows = [
  { id: 'a', title: 'Alpha notes', sortRank: 5, boost: 0 },
  { id: 'b', title: 'Beta notes', sortRank: 4, boost: 10 },
  { id: 'c', title: 'Gamma notes', sortRank: 3, boost: 0 },
  { id: 'd', title: 'Delta notes', sortRank: 2, boost: 0 },
  { id: 'x', title: 'Omega notes', sortRank: 1, boost: 0 },
  { id: 'e', title: 'Epsilon notes', sortRank: 0, boost: 0 },
];

type Row = (typeof rows)[number];
const config = { fields: [{ key: 'title', get: (row: Row) => row.title, weight: 1 }], limit: 10 };
const order = (items: readonly Row[], query = '') =>
  matchCommandPaletteSection({ items, query, config }).map((match) => match.item.id);

describe('withRecentVisits', () => {
  it(`puts the ${RECENT_VISIT_PINS} rows visited last first, newest visit first, then the rest by activity`, () => {
    const visited = withRecentVisits(rows, ['d', 'x', 'c', 'a'], 'e');

    expect(order(visited)).toEqual(['d', 'x', 'c', 'a', 'b', 'e']);
  });

  it('never lifts the open row, which stays last, and gives its pin to the next visit', () => {
    const visited = withRecentVisits(rows, ['e', 'd', 'x', 'c'], 'e');

    expect(order(visited)).toEqual(['d', 'x', 'c', 'a', 'b', 'e']);
    expect(visited.find((row) => row.id === 'e')).toBe(rows[5]);
  });

  it('skips visits to rows the list does not hold', () => {
    const visited = withRecentVisits(rows, ['gone', 'd'], undefined);

    expect(order(visited)).toEqual(['d', 'a', 'b', 'c', 'x', 'e']);
  });

  it('boosts every visited row by 20 for typed text, past an unread row, and leaves others as they are', () => {
    const visited = withRecentVisits(rows, ['d', 'x', 'c', 'a'], 'e');

    expect(visited.map((row) => row.boost)).toEqual([20, 10, 20, 20, 20, 0]);
    expect(visited[1]).toBe(rows[1]);
    // Every row matches "notes" equally well: the visited ones lead, the pinned ones newest visit
    // first, and the open one keeps no boost.
    expect(order(visited, 'notes')).toEqual(['d', 'x', 'c', 'a', 'b', 'e']);
  });

  it('returns the list itself when nothing was visited', () => {
    expect(withRecentVisits(rows, [], 'e')).toBe(rows);
  });
});
