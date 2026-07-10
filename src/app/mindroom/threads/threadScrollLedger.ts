export type ThreadLedgerEvent = {
  getId: () => string | undefined;
};

export type ThreadVirtualPrependCapture = {
  threadId: string;
  anchorEventId: string;
  anchorIndex: number;
  anchorSeq: number;
  abovePrices: Map<string, number>;
  foldedEvents: unknown;
};

export type ThreadLedgerFoldProbe =
  | 'threadPrependFoldAnchorFallback'
  | 'threadPrependFoldAnchorLost';

export type ThreadLedgerRenderPlan = {
  clearPendingAnchor: boolean;
  foldPx: number;
  nextCapture: ThreadVirtualPrependCapture | undefined;
  probe?: ThreadLedgerFoldProbe;
};

type PlanThreadLedgerRenderArgs = {
  capture: ThreadVirtualPrependCapture | undefined;
  eventIndexMap: ReadonlyMap<string, number>;
  paginatingBack: boolean;
  pendingAnchorSeq: number | undefined;
  priceRow: (eventId: string, index: number) => number;
  threadEvents: readonly ThreadLedgerEvent[];
  threadId?: string;
};

export const buildThreadFoldBaseline = (
  events: readonly ThreadLedgerEvent[],
  boundaryIndex: number,
  priceRow: (eventId: string, index: number) => number
): Map<string, number> => {
  const abovePrices = new Map<string, number>();
  for (let index = 1; index < boundaryIndex; index += 1) {
    const eventId = events[index]?.getId();
    if (eventId) abovePrices.set(eventId, priceRow(eventId, index));
  }
  return abovePrices;
};

/**
 * Derive the thread-prepend ledger update without mutating component refs,
 * pagination globals, probes, or DOM. React may abandon this render plan;
 * the caller applies it only from the commit phase.
 */
export const planThreadLedgerRender = ({
  capture,
  eventIndexMap,
  paginatingBack,
  pendingAnchorSeq,
  priceRow,
  threadEvents,
  threadId,
}: PlanThreadLedgerRenderArgs): ThreadLedgerRenderPlan => {
  if (!capture) {
    return { clearPendingAnchor: false, foldPx: 0, nextCapture: undefined };
  }

  if (capture.threadId !== (threadId ?? '') || pendingAnchorSeq !== capture.anchorSeq) {
    return { clearPendingAnchor: false, foldPx: 0, nextCapture: undefined };
  }

  if (!threadId || capture.foldedEvents === threadEvents) {
    return { clearPendingAnchor: false, foldPx: 0, nextCapture: capture };
  }

  let boundaryEventId = capture.anchorEventId;
  let boundaryIndex = eventIndexMap.get(boundaryEventId) ?? -1;
  let probe: ThreadLedgerFoldProbe | undefined;
  if (boundaryIndex < 0) {
    capture.abovePrices.forEach((_px, eventId) => {
      const index = eventIndexMap.get(eventId);
      if (typeof index === 'number' && index > boundaryIndex) {
        boundaryIndex = index;
        boundaryEventId = eventId;
      }
    });
    probe = boundaryIndex >= 0 ? 'threadPrependFoldAnchorFallback' : 'threadPrependFoldAnchorLost';
  }

  if (boundaryIndex < 0) {
    return {
      clearPendingAnchor: false,
      foldPx: 0,
      nextCapture: undefined,
      probe,
    };
  }

  let addedPx = 0;
  let addedCount = 0;
  for (let index = 1; index < boundaryIndex; index += 1) {
    const eventId = threadEvents[index]?.getId();
    if (eventId && !capture.abovePrices.has(eventId)) {
      addedPx += priceRow(eventId, index);
      addedCount += 1;
    }
  }

  let removedPx = 0;
  capture.abovePrices.forEach((px, eventId) => {
    if (eventIndexMap.get(eventId) === undefined) removedPx += px;
  });
  const foldPx = addedPx - removedPx;

  if (addedCount > 0 && !paginatingBack) {
    return {
      clearPendingAnchor: true,
      foldPx,
      nextCapture: undefined,
      probe,
    };
  }

  if (addedCount > 0 || removedPx !== 0) {
    return {
      clearPendingAnchor: false,
      foldPx,
      nextCapture: {
        ...capture,
        anchorEventId: boundaryEventId,
        anchorIndex: boundaryIndex,
        abovePrices: buildThreadFoldBaseline(threadEvents, boundaryIndex, priceRow),
        foldedEvents: threadEvents,
      },
      probe,
    };
  }

  return {
    clearPendingAnchor: false,
    foldPx: 0,
    nextCapture: {
      ...capture,
      anchorEventId: boundaryEventId,
      anchorIndex: boundaryIndex,
      foldedEvents: threadEvents,
    },
    probe,
  };
};
