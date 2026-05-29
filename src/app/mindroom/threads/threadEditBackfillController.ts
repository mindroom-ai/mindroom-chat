import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { Direction, RelationType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { getLatestEdit } from '../../utils/room';
import { logMindroomEditDebug as logEditDebug } from '../messages/editDebug';
import { getLinkedTimelines } from './timelinePagination';
import { isScrollNearBottom } from './timelineScrollUtils';
import { markThreadEditBackfillAttempted, shouldFetchThreadEditBackfill } from './threadEditBackfill';
import type { PersistThreadEventCache } from './threadCachePersistenceController';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

export const useThreadEditBackfillController = ({
  atLiveEndRef,
  eventId,
  forceTimelineUpdate,
  mx,
  persistThreadEventCache,
  room,
  scrollRef,
  scrollToBottomRef,
  setThreadTimelineTick,
  threadEditFetchAttemptedRef,
  threadEvents,
  threadId,
  threadIdRef,
  threadTailLoaded,
}: {
  atLiveEndRef: MutableRefObject<boolean>;
  eventId?: string;
  forceTimelineUpdate: () => void;
  mx: MatrixClient;
  persistThreadEventCache: PersistThreadEventCache;
  room: Room;
  scrollRef: RefObject<HTMLDivElement>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  threadEditFetchAttemptedRef: MutableRefObject<WeakMap<MatrixEvent, number>>;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  threadTailLoaded: boolean;
}): void => {
  useEffect(() => {
    if (!threadId || threadEvents.length === 0) return undefined;
    const targetedOpen = !!eventId;

    const missingEditEvents = threadEvents.filter((mEvent) =>
      shouldFetchThreadEditBackfill(
        mEvent,
        threadEditFetchAttemptedRef.current,
        threadTailLoaded,
        targetedOpen
      )
    );
    if (missingEditEvents.length === 0) {
      logEditDebug('threadBackfill:noneMissing', {
        targetedOpen,
        threadId,
        threadEventCount: threadEvents.length,
        threadTailLoaded,
      });
      return undefined;
    }

    logEditDebug('threadBackfill:start', {
      targetedOpen,
      threadId,
      threadEventCount: threadEvents.length,
      missingEditCount: missingEditEvents.length,
      threadTailLoaded,
    });

    missingEditEvents.forEach((mEvent) => {
      markThreadEditBackfillAttempted(
        mEvent,
        threadEditFetchAttemptedRef.current,
        threadTailLoaded
      );
    });

    let cancelled = false;
    const loadMissingThreadEdits = async () => {
      let didUpdate = false;
      let updatedCount = 0;
      const concurrency = 4;
      let cursor = 0;

      const worker = async () => {
        while (!cancelled && cursor < missingEditEvents.length) {
          const currentIndex = cursor;
          cursor += 1;

          const mEvent = missingEditEvents[currentIndex];
          const targetEventId = mEvent.getId();
          if (!targetEventId) continue;

          const [relErr, relData] = await to(
            mx.relations(room.roomId, targetEventId, RelationType.Replace, mEvent.getType(), {
              dir: Direction.Backward,
              limit: 100,
            })
          );
          if (cancelled) continue;
          if (relErr) {
            logEditDebug('threadBackfill:fetchError', {
              threadId,
              eventId: targetEventId,
              error: String(relErr),
            });
            continue;
          }
          const currentReplacement = mEvent.replacingEvent() ?? undefined;
          const relationEvents = relData?.events ?? [];
          if (relationEvents.length === 0 && !currentReplacement) {
            logEditDebug('threadBackfill:noRelations', {
              threadId,
              eventId: targetEventId,
            });
            continue;
          }

          const latestEdit = getLatestEdit(
            mEvent,
            currentReplacement ? [currentReplacement, ...relationEvents] : relationEvents
          );
          if (!latestEdit) continue;
          if (latestEdit === currentReplacement) {
            logEditDebug('threadBackfill:alreadyLatest', {
              threadId,
              eventId: targetEventId,
              editEventId: currentReplacement?.getId(),
              relationCount: relationEvents.length,
            });
            continue;
          }

          // Keep sender guard aligned with edit auth semantics.
          if (latestEdit.getSender() !== mEvent.getSender()) {
            logEditDebug('threadBackfill:senderMismatch', {
              threadId,
              eventId: targetEventId,
              editEventId: latestEdit.getId(),
              editSender: latestEdit.getSender(),
              targetSender: mEvent.getSender(),
            });
            continue;
          }

          mEvent.makeReplaced(latestEdit);
          didUpdate = true;
          updatedCount += 1;
          logEditDebug('threadBackfill:applied', {
            threadId,
            eventId: targetEventId,
            editEventId: latestEdit.getId(),
            editTs: latestEdit.getTs(),
            previousEditEventId: currentReplacement?.getId(),
            relationCount: relationEvents.length,
          });
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (didUpdate && !cancelled && threadIdRef.current === threadId) {
        const currentThread = room.getThread(threadId);
        const currentThreadTimelineSet = currentThread?.getUnfilteredTimelineSet();
        const firstThreadTimeline = currentThreadTimelineSet
          ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
          : undefined;

        logEditDebug('threadBackfill:updated', {
          threadId,
          updatedCount,
        });
        const scrollElement = scrollRef.current;
        // Use only fresh scroll measurement, not debounced atBottomRef (CINNY-031).
        if (
          atLiveEndRef.current &&
          scrollElement &&
          isScrollNearBottom({
            scrollHeight: scrollElement.scrollHeight,
            scrollTop: scrollElement.scrollTop,
            clientHeight: scrollElement.clientHeight,
          })
        ) {
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = false;
        }
        persistThreadEventCache(
          threadId,
          threadEvents,
          currentThread?.rootEvent ?? room.findEventById(threadId),
          firstThreadTimeline?.getPaginationToken(Direction.Backward),
          threadTailLoaded
        );
        forceTimelineUpdate();
        setThreadTimelineTick((val) => val + 1);
      } else {
        logEditDebug('threadBackfill:noUpdate', {
          threadId,
        });
      }
    };

    loadMissingThreadEdits();

    return () => {
      cancelled = true;
    };
  }, [
    atLiveEndRef,
    eventId,
    forceTimelineUpdate,
    mx,
    persistThreadEventCache,
    room,
    scrollRef,
    scrollToBottomRef,
    setThreadTimelineTick,
    threadEditFetchAttemptedRef,
    threadEvents,
    threadId,
    threadIdRef,
    threadTailLoaded,
  ]);
};
