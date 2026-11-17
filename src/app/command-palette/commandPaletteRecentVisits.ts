/** How many of the rows visited last lead the Threads and Rooms sections while nothing is typed. */
export const RECENT_VISIT_PINS = 3;

/** What a visited row gains for typed text: more than an unread thread (10). */
const RECENT_VISIT_BOOST = 20;

type RankedRow = { id: string; sortRank?: number; boost?: number };

/**
 * Lifts the rows the user visited last. `visitedIds` are row IDs, newest visit first; the open row
 * (`openId`) is never lifted and keeps its place. The first `RECENT_VISIT_PINS` visited rows the
 * list holds rank above every other row, newest visit first, so they lead while nothing is typed;
 * every visited row gains `RECENT_VISIT_BOOST` for typed text.
 */
export const withRecentVisits = <T extends RankedRow>(
  rows: T[],
  visitedIds: readonly string[],
  openId: string | undefined
): T[] => {
  const listed = new Set(rows.map((row) => row.id));
  const visitOrder = new Map<string, number>();
  visitedIds.forEach((id) => {
    if (id !== openId && listed.has(id) && !visitOrder.has(id)) visitOrder.set(id, visitOrder.size);
  });
  if (visitOrder.size === 0) return rows;
  const topRank = rows.reduce((top, row) => Math.max(top, row.sortRank ?? 0), 0);
  return rows.map((row) => {
    const visit = visitOrder.get(row.id);
    if (visit === undefined) return row;
    return {
      ...row,
      sortRank: visit < RECENT_VISIT_PINS ? topRank + RECENT_VISIT_PINS - visit : row.sortRank,
      boost: (row.boost ?? 0) + RECENT_VISIT_BOOST,
    };
  });
};
