import { useEffect, useMemo, useReducer, useRef } from 'react';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import {
  planThreadSummaryTimeline,
  type ThreadSummaryHistory,
} from '../../event-store/threads/threadSummaryTimeline';

type ThreadSummaryTimelineOptions = {
  history: ThreadSummaryHistory;
  /** The content an event's row shows, after its latest edit; keep it stable. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  isHidden?: (event: MatrixEvent) => boolean;
  /** The renderer repainted in-place row changes, including decryptions of pending edits. */
  rowRepaintRevision?: number;
  routeId?: string;
  focusId?: string;
};

export const useThreadSummaryTimeline = (
  events: readonly MatrixEvent[],
  {
    history,
    getContent,
    isHidden,
    rowRepaintRevision,
    routeId,
    focusId,
  }: ThreadSummaryTimelineOptions
) => {
  // A jumped-to summary stays visible after its temporary highlight ends.
  const revealed = useRef(new Set<string>());
  // Decryption can reveal a title or change whether an event between titles has a row.
  const [decryptions, countDecryption] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    // The wire type, so an event whose first attempt failed still counts.
    const encrypted = events.filter((event) => event.isEncrypted());
    encrypted.forEach((event) => event.on(MatrixEventEvent.Decrypted, countDecryption));
    return () => {
      encrypted.forEach((event) =>
        event.removeListener(MatrixEventEvent.Decrypted, countDecryption)
      );
    };
  }, [events]);

  const { sdkLoaded, canPaginateBack, hasMoreCachedBack } = history;
  return useMemo(() => {
    void decryptions;
    void rowRepaintRevision;
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    return planThreadSummaryTimeline(events, {
      history: { sdkLoaded, canPaginateBack, hasMoreCachedBack },
      revealedEventIds: revealed.current,
      getContent,
      isHidden,
    });
  }, [
    events,
    sdkLoaded,
    canPaginateBack,
    hasMoreCachedBack,
    getContent,
    isHidden,
    rowRepaintRevision,
    routeId,
    focusId,
    decryptions,
  ]);
};
