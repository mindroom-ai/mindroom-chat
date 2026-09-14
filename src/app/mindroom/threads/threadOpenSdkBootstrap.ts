import {
  Direction,
  type EventTimeline,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import type { Dispatch, SetStateAction } from 'react';
import to from 'await-to-js';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { isPendingLocalEchoThreadRoot } from './threadRouteUtils';
import {
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from './threadPaginationUtils';
import { getLinkedTimelines } from './timelinePagination';
import { logTimelineDebug } from './timelineDebug';
import { getThreadCursorAnchor } from './eventRepository';
import { isThreadNotFoundError } from './threadBootstrap';
import type { HydratedThreadCachePage } from './types';
import {
  appendThreadBootstrapRelations,
  createInitializedThreadForRoot,
  fetchThreadBootstrapRelations,
} from './sdk/threadBootstrapSdk';

type PersistThreadEventCache = (
  expectedThreadId: string,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent | null,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
) => void;

type RunThreadOpenSdkBootstrapOptions<TTimeline extends object> = {
  debugTraceId: string | undefined;
  hydratedCachedPage?: HydratedThreadCachePage;
  isMounted: () => boolean;
  mx: MatrixClient;
  onThreadLoadError?: (threadId: string) => void;
  persistThreadEventCache: PersistThreadEventCache;
  pinThreadToBottomOnOpen: () => void;
  room: Room;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadLoadError: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  setTimeline: Dispatch<SetStateAction<TTimeline>>;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
};

export const runThreadOpenSdkBootstrap = async <TTimeline extends object>({
  debugTraceId,
  hydratedCachedPage,
  isMounted,
  mx,
  onThreadLoadError,
  persistThreadEventCache,
  pinThreadToBottomOnOpen,
  room,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadLoadError,
  setThreadTailLoaded,
  setThreadTimelineTick,
  setTimeline,
  shouldScrollToLatestOnOpen,
  threadId,
}: RunThreadOpenSdkBootstrapOptions<TTimeline>): Promise<boolean> => {
  if (isPendingLocalEchoThreadRoot(room, threadId)) {
    setThreadTailLoaded(true);
    setTimeline((ct) => ({ ...ct }));
    setThreadTimelineTick((val) => val + 1);
    logTimelineDebug(debugTraceId, 'thread-open-pending-local-echo-root', {
      threadId,
    });
    if (shouldScrollToLatestOnOpen) {
      pinThreadToBottomOnOpen();
    }
    return false;
  }

  let threadModel = room.getThread(threadId);
  let createdZeroReplyThread = false;
  const zeroReplyStandaloneRootEvent = room.findEventById(threadId);
  if (
    !threadModel &&
    zeroReplyStandaloneRootEvent &&
    isZeroReplyStandaloneThreadRootEvent(zeroReplyStandaloneRootEvent)
  ) {
    threadModel = createInitializedThreadForRoot(room, zeroReplyStandaloneRootEvent);
    createdZeroReplyThread = true;
    setThreadTailLoaded(true);
    setTimeline((ct) => ({ ...ct }));
    setThreadTimelineTick((val) => val + 1);
    logTimelineDebug(debugTraceId, 'thread-open-zero-reply-root-without-thread-model', {
      threadId,
    });
    if (shouldScrollToLatestOnOpen) {
      pinThreadToBottomOnOpen();
    }
  }

  if (!threadModel) {
    const [ctxErr] = await to(mx.getEventTimeline(room.getUnfilteredTimelineSet(), threadId));
    if (!isMounted()) {
      return false;
    }
    if (ctxErr) {
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-context-error', {
        threadId,
      });
      setThreadLoadError(true);
      if (isThreadNotFoundError(ctxErr)) {
        onThreadLoadError?.(threadId);
      }
      return false;
    }
    threadModel = room.getThread(threadId);
  }

  if (!threadModel) {
    const [relErr, relData] = await to(fetchThreadBootstrapRelations(mx, room.roomId, threadId));
    if (!isMounted()) {
      return false;
    }
    if (relErr) {
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-relations-error', {
        threadId,
      });
      setThreadLoadError(true);
      if (isThreadNotFoundError(relErr)) {
        onThreadLoadError?.(threadId);
      }
      return false;
    }

    threadModel = room.getThread(threadId);
    if (!threadModel && relData?.chunk?.length) {
      const mapper = mx.getEventMapper();
      const mappedEvents = relData.chunk
        .slice()
        .reverse()
        .map((evt) => mapper(evt));
      setSupplementalThreadEvents(threadId, mappedEvents);
      persistThreadEventCache(
        threadId,
        mappedEvents,
        room.findEventById(threadId),
        relData.next_batch
      );
      reconcileThreadBackwardPagination(
        undefined,
        relData.next_batch ?? null,
        setThreadHasMoreCachedBack
      );
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-relations-fallback', {
        mappedCount: mappedEvents.length,
        nextBatchPresent: typeof relData.next_batch === 'string',
        threadId,
      });
    }
  }

  if (!threadModel) {
    logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-missing-thread-model', {
      threadId,
    });
    return true;
  }

  const loadedThreadTimelineSet = threadModel.getUnfilteredTimelineSet();
  const [err] = await to(mx.getThreadTimeline(loadedThreadTimelineSet, threadId));
  if (!isMounted()) {
    return false;
  }
  if (err) {
    logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-get-thread-timeline-error', {
      error: err,
      threadId,
    });
  }

  const firstThreadTimeline = getLinkedTimelines(loadedThreadTimelineSet.getLiveTimeline())[0];
  reconcileCachedThreadBackwardToken({
    cachedPage: hydratedCachedPage,
    firstThreadTimeline,
    threadEvents: threadModel.events,
    threadId,
  });

  if (threadModel.events.length === 0) {
    const [relErr, relData] = await to(fetchThreadBootstrapRelations(mx, room.roomId, threadId));
    if (!isMounted()) {
      return false;
    }
    if (!relErr && relData?.chunk?.length) {
      const mapper = mx.getEventMapper();
      const mappedEvents = relData.chunk
        .slice()
        .reverse()
        .map((evt) => mapper(evt));
      appendThreadBootstrapRelations({
        thread: threadModel,
        events: mappedEvents,
        firstTimeline: firstThreadTimeline,
        nextBatch: relData.next_batch,
      });
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-empty-thread-relations-fill', {
        mappedCount: mappedEvents.length,
        nextBatchPresent: typeof relData.next_batch === 'string',
        threadId,
      });
    }
  }

  logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-ready', {
    rootPresent: !!threadModel.rootEvent,
    sdkEventCount: threadModel.events.length,
    threadId,
  });
  persistThreadEventCache(
    threadId,
    threadModel.events,
    threadModel.rootEvent,
    firstThreadTimeline?.getPaginationToken(Direction.Backward)
  );

  if (firstThreadTimeline) {
    const sdkBackwardToken = firstThreadTimeline.getPaginationToken(Direction.Backward) ?? null;
    reconcileThreadBackwardPagination(
      firstThreadTimeline,
      sdkBackwardToken,
      setThreadHasMoreCachedBack
    );
  }

  return !createdZeroReplyThread;
};

const reconcileCachedThreadBackwardToken = ({
  cachedPage,
  firstThreadTimeline,
  threadEvents,
  threadId,
}: {
  cachedPage?: HydratedThreadCachePage;
  firstThreadTimeline?: EventTimeline;
  threadEvents: MatrixEvent[];
  threadId: string;
}): void => {
  const cachedEarliestAnchor = getThreadCursorAnchor(cachedPage?.events[0]);
  const earliestThreadReply = findEarliestLoadedThreadReplyByCacheOrder(threadEvents, threadId);
  const threadTimelineAnchor = getThreadCursorAnchor(
    earliestThreadReply?.event as Partial<IEvent> | undefined
  );
  if (
    firstThreadTimeline &&
    cachedPage?.beforeToken !== undefined &&
    cachedEarliestAnchor &&
    (!threadTimelineAnchor ||
      compareCachedPaginationAnchors(threadTimelineAnchor, cachedEarliestAnchor) >= 0)
  ) {
    firstThreadTimeline.setPaginationToken(cachedPage.beforeToken ?? null, Direction.Backward);
  }
};
