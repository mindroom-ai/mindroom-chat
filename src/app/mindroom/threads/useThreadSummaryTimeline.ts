import { useEffect, useMemo, useReducer, useRef } from 'react';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { MessageEvent } from '../../../types/matrix/room';
import { isMindroomThreadSummaryEvent } from '../messages/threadSummary';
import { planThreadSummaryTimeline, type ThreadSummaryHistory } from './threadSummaryTimeline';

type ThreadSummaryTimelineOptions = {
  history: ThreadSummaryHistory;
  /** The content an event's row shows, after its latest edit; keep it stable. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  routeId?: string;
  focusId?: string;
};

export const useThreadSummaryTimeline = (
  events: readonly MatrixEvent[],
  { history, getContent, routeId, focusId }: ThreadSummaryTimelineOptions
) => {
  // A jumped-to summary stays visible after its temporary highlight ends.
  const revealed = useRef(new Set<string>());
  // Live events reach the thread before they decrypt, so a summary is planned
  // again once it can be read.
  const [decryptions, countDecryption] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const encrypted = events.filter(
      (event) => event.getType() === MessageEvent.RoomMessageEncrypted
    );
    const decrypted = (event: MatrixEvent) => {
      if (isMindroomThreadSummaryEvent(event)) countDecryption();
    };
    encrypted.forEach((event) => event.on(MatrixEventEvent.Decrypted, decrypted));
    return () => {
      encrypted.forEach((event) => event.off(MatrixEventEvent.Decrypted, decrypted));
    };
  }, [events]);

  const { sdkLoaded, canPaginateBack, hasMoreCachedBack } = history;
  return useMemo(() => {
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    return planThreadSummaryTimeline(events, {
      history: { sdkLoaded, canPaginateBack, hasMoreCachedBack },
      revealedEventIds: revealed.current,
      getContent,
    });
    // `decryptions` replans once an encrypted summary is readable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    events,
    sdkLoaded,
    canPaginateBack,
    hasMoreCachedBack,
    getContent,
    routeId,
    focusId,
    decryptions,
  ]);
};
