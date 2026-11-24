import { describe, expect, it } from 'vitest';
import {
  countLeadingRecentVisits,
  RECENT_VISIT_PINS,
  withRecentVisits,
} from './commandPaletteRecentVisits';
import { getCommandPaletteRoomRanking } from './commandPaletteRoomRanking';
import { matchCommandPaletteSection } from './commandPaletteSearch';

// Rows as the palette builds them: ranked by activity, the open one (`e`) at rank 0.
type Row = { id: string; title: string; sortRank: number; boost: number; recentVisit?: boolean };
const rows: Row[] = [
  { id: 'a', title: 'Alpha notes', sortRank: 5, boost: 0 },
  { id: 'b', title: 'Beta notes', sortRank: 4, boost: 10 },
  { id: 'c', title: 'Gamma notes', sortRank: 3, boost: 0 },
  { id: 'd', title: 'Delta notes', sortRank: 2, boost: 0 },
  { id: 'x', title: 'Omega notes', sortRank: 1, boost: 0 },
  { id: 'e', title: 'Epsilon notes', sortRank: 0, boost: 0 },
];
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

  it('boosts pinned visits by 20 (above unread) and 4th+ visits by 5 (below unread)', () => {
    const visited = withRecentVisits(rows, ['d', 'x', 'c', 'a'], 'e');

    expect(visited.map((row) => row.boost)).toEqual([5, 10, 20, 20, 20, 0]);
    expect(visited[1]).toBe(rows[1]);
    // Every row matches "notes" equally well: pinned visits (20) lead newest first, then unvisited
    // unread (10), then the 4th+ read visit (5), then the open row (0).
    expect(order(visited, 'notes')).toEqual(['d', 'x', 'c', 'b', 'a', 'e']);

    // For rooms (unread boost 15): pinned visits (+20) beat an unvisited unread room (+15), which
    // beats a 4th+ older visit (+5).
    const roomRows = rows.map((row) =>
      row.id === 'b'
        ? {
            ...row,
            ...getCommandPaletteRoomRanking({
              roomId: row.id,
              activityRank: row.sortRank,
              unreadTotal: 1,
              unreadHighlights: 0,
            }),
          }
        : row
    );
    expect(order(withRecentVisits(roomRows, ['d', 'x', 'c', 'a'], 'e'), 'notes')).toEqual([
      'd',
      'x',
      'c',
      'b',
      'a',
      'e',
    ]);
  });

  it('returns the list itself when nothing was visited', () => {
    expect(withRecentVisits(rows, [], 'e')).toBe(rows);
  });

  it('marks recentVisit only on the promoted pins, not on 4th+ visits, the open row or unvisited rows', () => {
    const visited = withRecentVisits(rows, ['e', 'd', 'x', 'c', 'a'], 'e');
    const byId = new Map(visited.map((row) => [row.id, row]));

    expect(['d', 'x', 'c'].map((id) => byId.get(id)?.recentVisit)).toEqual([true, true, true]);
    expect(['d', 'x', 'c'].map((id) => byId.get(id)?.boost)).toEqual([20, 20, 20]);
    expect(byId.get('a')?.recentVisit).toBeUndefined();
    expect(byId.get('a')?.boost).toBe(5);
    expect(byId.get('b')?.recentVisit).toBeUndefined();
    expect(byId.get('e')?.recentVisit).toBeUndefined();
  });

  it('counts contiguous leading recentVisit rows from index 0', () => {
    expect(
      countLeadingRecentVisits([
        { id: 'a', recentVisit: true },
        { id: 'b', recentVisit: true },
        { id: 'c' },
        { id: 'd', recentVisit: true },
      ])
    ).toBe(2);
    expect(countLeadingRecentVisits([{ id: 'a' }])).toBe(0);
  });
});
