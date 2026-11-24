export type RoomLedgerKey = string | number | bigint;

/**
 * The reader's first visible row in the newest-first Threads view's last committed render, with
 * that render's row keys and row prices.
 */
export type RoomLedgerAnchor = {
  key: RoomLedgerKey;
  index: number;
  keys: readonly RoomLedgerKey[];
  priceRow: (key: RoomLedgerKey, index: number) => number;
};

/** How many rows after a moved anchor are tried before the rows count as replaced. */
const ANCHOR_CANDIDATES = 8;

/**
 * How far a newest-first Threads-view render shifts the reader's rows: rows that land above the
 * reader's first visible row, less the rows that left the space above it, so `scrollTop` can be
 * adjusted on commit and the reader keeps their place when a new thread arrives or an existing
 * thread gets a reply and moves to the top.
 *
 * A row that moved up past rows that were above it (the reader's own row got a reply and went to
 * the top) holds nothing; the next row after it that kept its place does. Pure: React may abandon
 * the render, and the caller applies the result only when it commits.
 */
export const planRoomLedgerRender = (
  anchor: RoomLedgerAnchor | undefined,
  keys: readonly RoomLedgerKey[],
  priceRow: (key: RoomLedgerKey, index: number) => number
): number => {
  if (!anchor) return 0;
  if (
    anchor.keys.length === keys.length &&
    anchor.keys.every((key, index) => key === keys[index])
  ) {
    return 0;
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
        let deltaPx = 0;
        for (let index = 0; index < boundary; index += 1) {
          const rowKey = keys[index];
          if (rowKey === undefined || above.delete(rowKey)) continue;
          deltaPx += priceRow(rowKey, index);
        }
        // Rows that left the space above the reader take their committed height with them.
        above.forEach((rowKey) => {
          deltaPx -= anchor.priceRow(rowKey, anchor.keys.indexOf(rowKey));
        });
        return deltaPx;
      }
    }
  }
  return 0;
};
