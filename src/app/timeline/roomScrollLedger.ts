export type RoomLedgerKey = string | number | bigint;

/** A room row as virtual-core laid it out: its key, its size, and whether it was measured. */
export type RoomLedgerRow = { key: RoomLedgerKey; size: number; measured: boolean };

/** The reader's first visible room row (`index`) in the rows of the last committed layout. */
export type RoomLedgerAnchor = { index: number; rows: readonly RoomLedgerRow[] };

/** How many rows after a moved anchor are tried before the rows count as replaced. */
const ANCHOR_CANDIDATES = 8;

/**
 * How far a committed layout of the room's rows pushed the reader's rows down since the last one,
 * so the offset ledger can fold that height and the reader's rows stay where they are, as native
 * scroll anchoring would keep them: rows that landed above the reader's first visible row, less
 * the rows that left the space above it, plus the change in the estimated size of rows above it
 * that are still unmeasured (a thread's badge, a sender's name). A measured row's change of size
 * is left to virtual-core, which corrects the scroll for it itself.
 *
 * In the Threads view sorted by last reply, newest first, a new thread, or a thread that gets a
 * reply, lands at the top, above a reader who scrolled down, and its unmounted row's estimate
 * changes as its reply streams in. A row that moved up past rows that were above it (the
 * reader's own row got a reply and went to the top) holds nothing; the next row after it that
 * kept its place does.
 */
export const planRoomLedgerFold = (
  anchor: RoomLedgerAnchor | undefined,
  rows: readonly RoomLedgerRow[]
): number => {
  if (!anchor) return 0;
  const newIndex = new Map<RoomLedgerKey, number>();
  rows.forEach((row, index) => newIndex.set(row.key, index));
  const last = Math.min(anchor.rows.length, anchor.index + ANCHOR_CANDIDATES);
  for (let candidate = anchor.index; candidate < last; candidate += 1) {
    const key = anchor.rows[candidate]?.key;
    const boundary = key === undefined ? undefined : newIndex.get(key);
    if (boundary !== undefined) {
      const above = new Map<RoomLedgerKey, RoomLedgerRow>();
      let kept = true;
      for (let index = 0; index < candidate; index += 1) {
        const previous = anchor.rows[index];
        if (!previous) continue;
        above.set(previous.key, previous);
        const now = newIndex.get(previous.key);
        // A row that was above it and is now below it: this row moved up past it.
        if (now !== undefined && now > boundary) kept = false;
      }
      if (kept) {
        let foldPx = 0;
        for (let index = 0; index < boundary; index += 1) {
          const row = rows[index];
          if (!row) continue;
          const before = above.get(row.key);
          if (!before) foldPx += row.size;
          else if (!row.measured && !before.measured) foldPx += row.size - before.size;
          above.delete(row.key);
        }
        // Rows that left the space above the reader take their height with them.
        above.forEach((row) => {
          foldPx -= row.size;
        });
        return foldPx;
      }
    }
  }
  return 0;
};
