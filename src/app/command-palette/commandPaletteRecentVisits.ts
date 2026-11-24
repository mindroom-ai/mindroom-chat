/** How many of the rows visited last lead the Threads and Rooms sections while nothing is typed. */
export const RECENT_VISIT_PINS = 3;

/** What a pinned recent visit gains for typed text: more than an unread thread (10). */
const RECENT_VISIT_PIN_BOOST = 20;

/** What an older remembered visit gains for typed text: less than an unread thread (10). */
const RECENT_VISIT_BOOST = 5;

type RankedRow = { id: string; sortRank?: number; boost?: number; recentVisit?: boolean };

/**
 * Lifts the rows the user visited last. `visitedIds` are row IDs, newest visit first; the open row
 * (`openId`) is never lifted and keeps its place. The first `RECENT_VISIT_PINS` visited rows the
 * list holds rank above every other row, newest visit first, so they lead while nothing is typed,
 * and gain `RECENT_VISIT_PIN_BOOST` for typed text; older remembered visits keep their rank and
 * gain `RECENT_VISIT_BOOST`. Typed matches of one score and boost fall back to that rank too, so
 * among them the visit last made still comes first.
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
    const pinned = visit < RECENT_VISIT_PINS;
    return {
      ...row,
      sortRank: pinned ? topRank + RECENT_VISIT_PINS - visit : row.sortRank,
      boost: (row.boost ?? 0) + (pinned ? RECENT_VISIT_PIN_BOOST : RECENT_VISIT_BOOST),
      ...(pinned ? { recentVisit: true } : undefined),
    };
  });
};

/** Counts contiguous leading rows marked as promoted recent visits from index 0. */
export const countLeadingRecentVisits = (items: readonly RankedRow[]): number => {
  let count = 0;
  for (const item of items) {
    if (item.recentVisit !== true) break;
    count += 1;
  }
  return count;
};
