import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import to from 'await-to-js';
import { THREAD_BATCH_SIZE } from './preloadSettings';
import { getLinkedTimelines } from './timelinePagination';
import {
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from './threadPaginationUtils';
import { createPreferLiveEventMapper, loadThreadCachedPaginationSnapshot } from './eventRepository';
import { waitForScrollQuiescence } from './scrollQuiescence';
import type { PersistThreadEventCache } from '../engine/enginePersistFacade';

type ThreadBackPaginationFinishOptions = {
  currentThreadId?: string;
  didPaginateBack: boolean;
  threadId: string;
};

export const useThreadPaginationCommandController = ({
  beginThreadBackPagination,
  recaptureThreadBackPaginationAnchor,
  clearThreadBackPaginationAnchor,
  finishThreadBackPagination,
  forceTimelineUpdate,
  mx,
  persistThreadEventCache,
  room,
  scrollRef,
  sessionId,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadLatestOpenPending,
  setThreadPaginatingFront,
  setThreadTailLoaded,
  setThreadTimelineTick,
  thread,
  threadEvents,
  threadId,
  threadIdRef,
}: {
  beginThreadBackPagination: (
    threadId: string,
    scrollRoot: HTMLElement | null,
    eventCount?: number
  ) => boolean;
  // Task #125 follow-up: refresh the prepend restore anchor to the
  // user's CURRENT position after the quiescence wait — the begin-time
  // anchor goes stale while the user keeps scrolling between fire and
  // commit, and restoring it would teleport them back. Returns false
  // when no anchor could be captured (viewport in a virtualized/
  // loading gap); the commit is then SKIPPED — the fetched page is
  // already persisted, so the next gesture retries as a cache-hit —
  // because committing without a restore would shift the viewport by
  // the prepended height.
  recaptureThreadBackPaginationAnchor: (
    threadId: string,
    scrollRoot: HTMLElement | null,
    eventCount?: number
  ) => boolean;
  // Clears any armed prepend-restore anchor. Called on the stale-
  // thread bailouts: `finish` deliberately skips clearing when the
  // active thread changed mid-flight, so without this an anchor from
  // an aborted pagination could be consumed after returning to the
  // original thread.
  clearThreadBackPaginationAnchor: () => void;
  finishThreadBackPagination: (options: ThreadBackPaginationFinishOptions) => void;
  forceTimelineUpdate: () => void;
  mx: MatrixClient;
  persistThreadEventCache: PersistThreadEventCache;
  room: Room;
  scrollRef: RefObject<HTMLDivElement>;
  sessionId: string;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadLatestOpenPending: Dispatch<SetStateAction<boolean>>;
  setThreadPaginatingFront: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  thread: Thread | null | undefined;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}) => {
  const threadPaginatingFrontRef = useRef(false);

  const handleThreadPaginateBack = useCallback(async () => {
    if (!threadId || !beginThreadBackPagination(threadId, scrollRef.current, threadEvents.length))
      return;
    const expectedThreadId = threadId;

    setThreadLatestOpenPending(false);
    let didPaginateBack = false;
    try {
      const earliestThreadReply = findEarliestLoadedThreadReplyByCacheOrder(
        threadEvents,
        expectedThreadId
      );
      const mapper = mx.getEventMapper();
      const cachedPaginationSnapshot = await loadThreadCachedPaginationSnapshot({
        sessionId,
        roomId: room.roomId,
        threadId: expectedThreadId,
        earliestLoadedReply: earliestThreadReply,
        limit: THREAD_BATCH_SIZE,
        mapEvent: createPreferLiveEventMapper(room, mapper),
      });
      if (threadIdRef.current !== expectedThreadId) {
        // Thread switched mid-flight: finish() deliberately skips
        // clearing on thread mismatch, so drop the begin-time anchor
        // here — it must not be consumable after returning to the
        // original thread (greptile round 3 on PR #75).
        clearThreadBackPaginationAnchor();
        return;
      }

      if (cachedPaginationSnapshot.status === 'cache-hit') {
        const cachedPage = cachedPaginationSnapshot.cachedPage;
        const cachedEvents = cachedPaginationSnapshot.events;
        const currentThreadTimelineSet = thread?.getUnfilteredTimelineSet();
        const currentFirstThreadTimeline = currentThreadTimelineSet
          ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
          : undefined;
        if (currentFirstThreadTimeline && cachedPage.beforeToken !== undefined) {
          currentFirstThreadTimeline.setPaginationToken(
            cachedPage.beforeToken ?? null,
            Direction.Backward
          );
        }
        // Task #125 follow-up: the data is ready, but the RENDER
        // COMMIT (state writes → prepend offset shift → anchor-restore
        // scrollTop writes) waits for scroll quiescence. iOS WebKit
        // kills flick momentum on any programmatic scrollTop write,
        // and the scroll-driven trigger fires mid-flick by design —
        // committing immediately stopped every upward flick dead on
        // finger release.
        await waitForScrollQuiescence(scrollRef.current);
        if (threadIdRef.current !== expectedThreadId) {
          clearThreadBackPaginationAnchor();
          return;
        }
        if (
          !recaptureThreadBackPaginationAnchor(
            expectedThreadId,
            scrollRef.current,
            threadEvents.length
          )
        ) {
          // No valid anchor → no commit. The page stays cached; the
          // next gesture retries as a cache-hit.
          return;
        }
        setSupplementalThreadEvents(expectedThreadId, cachedEvents);
        setThreadHasMoreCachedBack(cachedPaginationSnapshot.hasMoreCachedBack);
        forceTimelineUpdate();
        setThreadTimelineTick((val) => val + 1);
        didPaginateBack = true;
        return;
      }

      setThreadHasMoreCachedBack(false);
      if (!thread) return;

      const currentThreadTimelineSet = thread.getUnfilteredTimelineSet();
      const firstThreadTimeline = getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0];
      if (!firstThreadTimeline?.getPaginationToken(Direction.Backward)) return;

      const [err] = await to(
        mx.paginateEventTimeline(firstThreadTimeline, {
          backwards: true,
          limit: THREAD_BATCH_SIZE,
        })
      );
      if (!err && threadIdRef.current === expectedThreadId) {
        // Persist immediately (IDB write, no render impact) …
        persistThreadEventCache(
          expectedThreadId,
          thread.events,
          thread.rootEvent,
          firstThreadTimeline.getPaginationToken(Direction.Backward)
        );
        // … but hold the render commit for scroll quiescence, same as
        // the cache-hit branch (see comment there).
        await waitForScrollQuiescence(scrollRef.current);
        if (threadIdRef.current !== expectedThreadId) {
          clearThreadBackPaginationAnchor();
          return;
        }
        if (
          !recaptureThreadBackPaginationAnchor(
            expectedThreadId,
            scrollRef.current,
            threadEvents.length
          )
        ) {
          // No valid anchor → no commit (page persisted above; next
          // gesture retries as a cache-hit).
          return;
        }
        reconcileThreadBackwardPagination(
          firstThreadTimeline,
          firstThreadTimeline.getPaginationToken(Direction.Backward),
          setThreadHasMoreCachedBack
        );
        forceTimelineUpdate();
        setThreadTimelineTick((val) => val + 1);
        didPaginateBack = true;
      }
    } finally {
      finishThreadBackPagination({
        didPaginateBack,
        threadId: expectedThreadId,
        currentThreadId: threadIdRef.current,
      });
    }
  }, [
    beginThreadBackPagination,
    recaptureThreadBackPaginationAnchor,
    clearThreadBackPaginationAnchor,
    finishThreadBackPagination,
    forceTimelineUpdate,
    mx,
    persistThreadEventCache,
    room,
    scrollRef,
    sessionId,
    setSupplementalThreadEvents,
    setThreadHasMoreCachedBack,
    setThreadLatestOpenPending,
    setThreadTimelineTick,
    thread,
    threadEvents,
    threadId,
    threadIdRef,
  ]);

  const handleThreadPaginateFront = useCallback(async () => {
    if (!threadId || !thread || threadPaginatingFrontRef.current) return;
    const currentThreadTimelineSet = thread.getUnfilteredTimelineSet();
    const currentThreadLinkedTimelines = getLinkedTimelines(
      currentThreadTimelineSet.getLiveTimeline()
    );
    const currentLastThreadTimeline =
      currentThreadLinkedTimelines[currentThreadLinkedTimelines.length - 1];
    if (!currentLastThreadTimeline) return;
    if (!currentLastThreadTimeline.getPaginationToken(Direction.Forward)) return;

    const expectedThreadId = threadId;
    setThreadPaginatingFront(true);
    threadPaginatingFrontRef.current = true;
    const [err] = await to(
      mx.paginateEventTimeline(currentLastThreadTimeline, {
        backwards: false,
        limit: THREAD_BATCH_SIZE,
      })
    );
    setThreadPaginatingFront(false);
    threadPaginatingFrontRef.current = false;
    if (!err && threadIdRef.current === expectedThreadId) {
      const tailLoaded = !currentLastThreadTimeline.getPaginationToken(Direction.Forward);
      persistThreadEventCache(
        expectedThreadId,
        thread.events,
        thread.rootEvent,
        undefined,
        tailLoaded
      );
      setThreadTailLoaded(tailLoaded);
      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
    }
  }, [
    forceTimelineUpdate,
    mx,
    persistThreadEventCache,
    setThreadPaginatingFront,
    setThreadTailLoaded,
    setThreadTimelineTick,
    thread,
    threadId,
    threadIdRef,
  ]);

  return {
    handleThreadPaginateBack,
    handleThreadPaginateFront,
  };
};
