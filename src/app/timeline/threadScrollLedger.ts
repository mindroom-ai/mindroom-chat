export type ThreadLedgerEvent = {
  getId: () => string | undefined;
};

/**
 * The reader's first visible row in the last committed thread render, with the
 * event list and row prices of that render. The thread root is the row whose ID
 * is `threadId`: index 0, or after a fork's parent rows.
 */
export type ThreadLedgerAnchor = {
  threadId: string;
  eventId: string;
  index: number;
  events: readonly ThreadLedgerEvent[];
  priceRow: (eventId: string, index: number) => number;
  /** What priced the rows besides their events (hidden rows, folded turns), by identity. */
  pricing?: unknown;
};

export type ThreadLedgerFoldProbe =
  'threadPrependFoldAnchorFallback' | 'threadPrependFoldAnchorLost';

export type ThreadLedgerRenderPlan = {
  foldPx: number;
  probe?: ThreadLedgerFoldProbe;
};

type PlanThreadLedgerRenderArgs = {
  anchor: ThreadLedgerAnchor | undefined;
  eventIndexMap: ReadonlyMap<string, number>;
  priceRow: (eventId: string, index: number) => number;
  /** As `ThreadLedgerAnchor.pricing`, of this render. */
  pricing?: unknown;
  threadEvents: readonly ThreadLedgerEvent[];
  threadId?: string;
};

/**
 * Derive how far the rows above the reader push the reader down, so the
 * ledger can fold that height and keep the reader's rows in place: what they
 * are priced at in this render, less what they were priced at in the render
 * the reader's row was recorded in. This holds for every change to the
 * thread's rows (Load Older, the opening history chain, reconciled or
 * recovered pages) and to their prices (a row that folds away with its turn
 * before it was ever measured), like native scroll anchoring, which the
 * thread scroller disables. A measured row has the same price in both, its
 * size: the measurement correction keeps the reader when it changes. Pure:
 * React may abandon this render plan, and the caller applies it only from the
 * commit phase.
 */
export const planThreadLedgerRender = ({
  anchor,
  eventIndexMap,
  priceRow,
  pricing,
  threadEvents,
  threadId,
}: PlanThreadLedgerRenderArgs): ThreadLedgerRenderPlan => {
  if (
    !anchor ||
    !threadId ||
    anchor.threadId !== threadId ||
    (anchor.events === threadEvents && anchor.pricing === pricing)
  ) {
    return { foldPx: 0 };
  }

  let previousIndex = anchor.index;
  let boundaryIndex = eventIndexMap.get(anchor.eventId);
  let probe: ThreadLedgerFoldProbe | undefined;
  if (boundaryIndex === undefined) {
    // The reader's row left; hold the nearest row above it that survived, other than the root.
    for (previousIndex = anchor.index - 1; previousIndex >= 0; previousIndex -= 1) {
      const eventId = anchor.events[previousIndex]?.getId();
      boundaryIndex =
        eventId === undefined || eventId === threadId ? undefined : eventIndexMap.get(eventId);
      if (boundaryIndex !== undefined) break;
    }
    if (boundaryIndex === undefined) return { foldPx: 0, probe: 'threadPrependFoldAnchorLost' };
    probe = 'threadPrependFoldAnchorFallback';
  }
  // The root is not folded: the reader sees it arrive. A fork's parent rows above it are.
  let foldPx = 0;
  for (let index = 0; index < boundaryIndex; index += 1) {
    const eventId = threadEvents[index]?.getId();
    if (eventId && eventId !== threadId) foldPx += priceRow(eventId, index);
  }
  // Rows that left the space above the reader take their committed height with them.
  for (let index = 0; index < previousIndex; index += 1) {
    const eventId = anchor.events[index]?.getId();
    if (eventId && eventId !== threadId) foldPx -= anchor.priceRow(eventId, index);
  }
  return probe ? { foldPx, probe } : { foldPx };
};
