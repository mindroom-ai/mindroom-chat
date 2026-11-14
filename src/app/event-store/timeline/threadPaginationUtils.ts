import { Direction, EventTimeline, MatrixEvent } from 'matrix-js-sdk';
import { eventBelongsToThread } from '../threads/threadUtils';
import { compareCachedPaginationAnchors } from '../cache/eventCacheTokenUtils';

/**
 * Find the earliest reply in a thread's loaded events, using timestamp + event ID
 * as a stable tie-breaker (matching cache ordering). The thread root is excluded.
 */
export const findEarliestLoadedThreadReplyByCacheOrder = (
  events: MatrixEvent[],
  threadId: string
): MatrixEvent | undefined => {
  let earliest: MatrixEvent | undefined;
  let earliestAnchor: { eventId: string; ts: number } | undefined;

  for (const mEvent of events) {
    const eventId = mEvent.getId();
    if (!eventId || eventId === threadId || !eventBelongsToThread(mEvent, threadId)) continue;
    const anchor = { eventId, ts: mEvent.getTs() ?? 0 };
    if (!earliestAnchor || compareCachedPaginationAnchors(anchor, earliestAnchor) < 0) {
      earliest = mEvent;
      earliestAnchor = anchor;
    }
  }

  return earliest;
};

/**
 * Reconcile the backward pagination token on a thread timeline from the cached
 * token for the earliest loaded reply.
 *
 * - `null` → server confirmed no more pages; clear token and hide button.
 * - `string` → more pages exist; set token and show button.
 * - `undefined` → no cache data; preserve SDK token (safe fallback).
 */
export const reconcileThreadBackwardPagination = (
  firstThreadTimeline: EventTimeline | undefined,
  cachedToken: string | null | undefined,
  setHasMoreCachedBack: (hasMoreCachedBack: boolean) => void
): void => {
  if (cachedToken === null) {
    firstThreadTimeline?.setPaginationToken(null, Direction.Backward);
    setHasMoreCachedBack(false);
  } else if (typeof cachedToken === 'string') {
    firstThreadTimeline?.setPaginationToken(cachedToken, Direction.Backward);
    setHasMoreCachedBack(true);
  }
  // undefined: no cache data — preserve SDK token
};
