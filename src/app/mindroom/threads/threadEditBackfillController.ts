import {
  useEffect,
  useRef,
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
import type { PersistThreadEventCache } from '../engine/enginePersistFacade';

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
  // Task #129: events currently being backfilled, so a re-run of this
  // effect (its dep list includes `threadEvents`, which our cache work
  // churns frequently) does not re-enqueue an in-flight fetch. This
  // replaces the old "mark attempted up front" approach, which stranded
  // events permanently: the effect marked every candidate attempted
  // BEFORE the async fetch, then any threadEvents change cancelled the
  // in-flight batch — leaving events marked-but-unresolved that the gate
  // then refused to retry, producing contiguous mid-thread "Thinking…"
  // placeholder bands that never self-repair. We now mark attempted only
  // after a DEFINITIVE outcome (edit applied, or confirmed no newer edit
  // exists) and never on cancel/error, so a cancelled batch is retried.
  //
  // In-flight is a Map<eventId, token> keyed by the stable event id (NOT
  // the MatrixEvent instance) with a per-fetch unique token. Overlapping
  // effect runs can otherwise race on shared state: a cancelled run's
  // cleanup must not delete an entry a later run now owns. Each fetch
  // deletes its entry only if the map still holds its own token, so
  // ownership is unambiguous and cross-run deletion is impossible.
  const inFlightRef = useRef<Map<string, symbol>>(new Map());
  // A `threadEvents` churn (which is frequent) must NOT cancel an
  // in-flight fetch — its result is still valid for the same thread, and
  // cancelling was what stranded the placeholder band. So work is bound
  // to component lifetime + thread identity, not to a per-effect-run
  // flag: `unmountedRef` flips only on true unmount (empty-deps effect,
  // whose cleanup runs once), and thread changes are caught by
  // comparing `threadIdRef.current` to this run's `threadId`.
  const unmountedRef = useRef(false);
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    []
  );
  useEffect(() => {
    if (!threadId || threadEvents.length === 0) return undefined;
    const targetedOpen = !!eventId;
    const inFlight = inFlightRef.current;
    const isStale = () => unmountedRef.current || threadIdRef.current !== threadId;

    const missingEditEvents = threadEvents.filter((mEvent) => {
      const id = mEvent.getId();
      return (
        !!id &&
        !inFlight.has(id) &&
        shouldFetchThreadEditBackfill(
          mEvent,
          threadEditFetchAttemptedRef.current,
          threadTailLoaded,
          targetedOpen
        )
      );
    });
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

    const loadMissingThreadEdits = async () => {
      let didUpdate = false;
      let updatedCount = 0;
      const concurrency = 4;
      let cursor = 0;

      const worker = async () => {
        while (!isStale() && cursor < missingEditEvents.length) {
          const currentIndex = cursor;
          cursor += 1;

          const mEvent = missingEditEvents[currentIndex];
          const targetEventId = mEvent.getId();
          if (!targetEventId) continue;
          // Another still-running effect run already owns this id's
          // fetch (its token is in the map) — don't duplicate it.
          if (inFlight.has(targetEventId)) continue;

          // Claim ownership with a unique token; release only if the map
          // still holds OUR token, so a concurrent run's entry is never
          // clobbered.
          const token = Symbol(targetEventId);
          inFlight.set(targetEventId, token);
          const release = () => {
            if (inFlight.get(targetEventId) === token) inFlight.delete(targetEventId);
          };

          const [relErr, relData] = await to(
            mx.relations(room.roomId, targetEventId, RelationType.Replace, mEvent.getType(), {
              dir: Direction.Backward,
              limit: 100,
            })
          );
          // Stale (unmounted or thread changed) / error are NON-definitive:
          // release the claim so a later pass retries, but do NOT mark
          // attempted (task #129 — marking here is exactly what stranded
          // the placeholder band).
          if (isStale()) {
            release();
            continue;
          }
          if (relErr) {
            logEditDebug('threadBackfill:fetchError', {
              threadId,
              eventId: targetEventId,
              error: String(relErr),
            });
            release();
            continue;
          }

          // From here every exit is DEFINITIVE (the fetch succeeded, so
          // the server's edit state for this event is known): apply if
          // there is a newer same-sender edit, then mark attempted so we
          // do not refetch (the target's own body stays "Thinking…" even
          // after a successful makeReplaced — the edit lives in
          // replacingEvent() — so the gate would otherwise loop forever).
          try {
            const currentReplacement = mEvent.replacingEvent() ?? undefined;
            const relationEvents = relData?.events ?? [];
            if (relationEvents.length === 0 && !currentReplacement) {
              logEditDebug('threadBackfill:noRelations', { threadId, eventId: targetEventId });
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
          } finally {
            // Definitive outcome reached (not cancelled, not errored):
            // record the attempt so the gate stops re-selecting this
            // instance, and release the claim. dir=Backward returns the
            // most-recent relations first, so even a partial (100-item)
            // page contains the newest edit — the one getLatestEdit
            // picks — making "attempted" safe here.
            markThreadEditBackfillAttempted(
              mEvent,
              threadEditFetchAttemptedRef.current,
              threadTailLoaded
            );
            release();
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (didUpdate && !isStale()) {
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

    // No cleanup cancellation: a threadEvents churn must let in-flight
    // fetches finish and apply (cancelling them stranded the band). Stale
    // work is stopped via unmountedRef / threadIdRef inside the loop, and
    // each worker releases its own token-guarded claim.
    return undefined;
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
