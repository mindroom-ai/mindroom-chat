export type RoomLedgerKey = string | number | bigint;

/**
 * The reader's first visible room row in the last committed render, with that render's row keys
 * and the size each row had in its measurements (measured, or estimated while unmounted).
 */
export type RoomLedgerAnchor = {
  key: RoomLedgerKey;
  index: number;
  keys: readonly RoomLedgerKey[];
  sizes: readonly number[];
};

export type RoomLedgerRows = {
  /** A row's size in this render: measured, or estimated. */
  price: (key: RoomLedgerKey, index: number) => number;
  /** Whether the row has been measured: virtual-core then corrects its size changes itself. */
  measured: (key: RoomLedgerKey) => boolean;
};

/** How many rows after a moved anchor are tried before the rows count as replaced. */
const ANCHOR_CANDIDATES = 8;

/**
 * How far a render's room rows push the reader's rows down, so the offset ledger can fold that
 * height and the reader's rows stay where they are, as native scroll anchoring would keep them:
 * rows that land above the reader's first visible row, less the rows that left the space above
 * it, plus the change in the estimated size of unmeasured rows above it (a thread's badge, a
 * sender's name). In the Threads view sorted by last reply, newest first, a new thread, or a
 * thread that gets a reply, lands at the top, above a reader who scrolled down, and its row's
 * estimate changes as its reply streams in.
 *
 * A row that moved up past rows that were above it (the reader's own row got a reply and went to
 * the top) holds nothing; the next row after it that kept its place does. Pure: React may abandon
 * the render, and the caller applies the result only when it commits.
 */
export const planRoomLedgerRender = (
  anchor: RoomLedgerAnchor | undefined,
  keys: readonly RoomLedgerKey[],
  rows: RoomLedgerRows
): number => {
  if (!anchor) return 0;
  const newIndex = new Map<RoomLedgerKey, number>();
  keys.forEach((key, index) => newIndex.set(key, index));
  const last = Math.min(anchor.keys.length, anchor.index + ANCHOR_CANDIDATES);
  for (let candidate = anchor.index; candidate < last; candidate += 1) {
    const key = anchor.keys[candidate];
    const boundary = key === undefined ? undefined : newIndex.get(key);
    if (boundary !== undefined) {
      const above = new Map<RoomLedgerKey, number>();
      let kept = true;
      for (let index = 0; index < candidate; index += 1) {
        const previous = anchor.keys[index];
        if (previous === undefined) continue;
        above.set(previous, anchor.sizes[index] ?? 0);
        const now = newIndex.get(previous);
        // A row that was above it and is now below it: this row moved up past it.
        if (now !== undefined && now > boundary) kept = false;
      }
      if (kept) {
        let foldPx = 0;
        for (let index = 0; index < boundary; index += 1) {
          const rowKey = keys[index];
          if (rowKey === undefined) continue;
          const before = above.get(rowKey);
          if (before === undefined) foldPx += rows.price(rowKey, index);
          else if (!rows.measured(rowKey)) foldPx += rows.price(rowKey, index) - before;
          above.delete(rowKey);
        }
        // Rows that left the space above the reader take their committed height with them.
        above.forEach((size) => {
          foldPx -= size;
        });
        return foldPx;
      }
    }
  }
  return 0;
};
