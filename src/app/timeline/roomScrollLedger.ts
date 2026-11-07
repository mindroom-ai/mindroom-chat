export type RoomLedgerKey = string | number | bigint;

/**
 * The reader's first visible room row in the last committed render, with that render's row keys
 * and row prices.
 */
export type RoomLedgerAnchor = {
  key: RoomLedgerKey;
  index: number;
  keys: readonly RoomLedgerKey[];
  priceRow: (key: RoomLedgerKey, index: number) => number;
};

/** How many rows after a moved anchor are tried before the rows count as replaced. */
const ANCHOR_CANDIDATES = 8;

/** What a render's room rows do to the offset ledger. */
export type RoomLedgerFold = {
  /** How far the rows push the reader's rows down: the height the ledger folds. */
  foldPx: number;
  /**
   * The part of `foldPx` that rows new to the list, less rows gone from it, bring with their own
   * height: the list grows by as much as it folds, so it is no room the list will give up
   * (`listShrinkNotRendered`). A thread that moves above the reader from below brings none.
   */
  addedPx: number;
};

const NO_FOLD: RoomLedgerFold = { foldPx: 0, addedPx: 0 };

/**
 * How far a render's room rows push the reader's rows down: rows that land above the reader's
 * first visible row, less the rows that left the space above it, so the offset ledger can fold
 * that height and the reader's rows stay where they are, as native scroll anchoring would keep
 * them. In the Threads view sorted by last reply, newest first, a new thread, or a thread that
 * gets a reply, lands at the top, above a reader who scrolled down.
 *
 * A row that moved up past rows that were above it (the reader's own row got a reply and went to
 * the top) holds nothing; the next row after it that kept its place does. Pure: React may abandon
 * the render, and the caller applies the result only when it commits.
 */
export const planRoomLedgerRender = (
  anchor: RoomLedgerAnchor | undefined,
  keys: readonly RoomLedgerKey[],
  priceRow: (key: RoomLedgerKey, index: number) => number
): RoomLedgerFold => {
  if (!anchor) return NO_FOLD;
  if (
    anchor.keys.length === keys.length &&
    anchor.keys.every((key, index) => key === keys[index])
  ) {
    return NO_FOLD;
  }
  const newIndex = new Map<RoomLedgerKey, number>();
  keys.forEach((key, index) => newIndex.set(key, index));
  for (
    let candidate = anchor.index;
    candidate < Math.min(anchor.keys.length, anchor.index + ANCHOR_CANDIDATES);
    candidate += 1
  ) {
    const key = anchor.keys[candidate];
    const boundary = key === undefined ? undefined : newIndex.get(key);
    if (boundary !== undefined) {
      const above = new Set<RoomLedgerKey>();
      let kept = true;
      for (let index = 0; index < candidate; index += 1) {
        const previous = anchor.keys[index];
        if (previous === undefined) continue;
        above.add(previous);
        const now = newIndex.get(previous);
        // A row that was above it and is now below it: this row moved up past it.
        if (now !== undefined && now > boundary) kept = false;
      }
      if (kept) {
        const listed = new Set(anchor.keys);
        let foldPx = 0;
        let addedPx = 0;
        for (let index = 0; index < boundary; index += 1) {
          const rowKey = keys[index];
          if (rowKey === undefined || above.delete(rowKey)) continue;
          const px = priceRow(rowKey, index);
          foldPx += px;
          if (!listed.has(rowKey)) addedPx += px;
        }
        // Rows that left the space above the reader take their committed height with them.
        above.forEach((rowKey) => {
          const px = anchor.priceRow(rowKey, anchor.keys.indexOf(rowKey));
          foldPx -= px;
          if (!newIndex.has(rowKey)) addedPx -= px;
        });
        return { foldPx, addedPx };
      }
    }
  }
  return NO_FOLD;
};
