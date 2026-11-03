import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { createSessionId } from '../../state/sessions';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { isIOSStandaloneWebApp } from '../native/nativeSso';
import { useEdgeSwipeBack } from '../native/useEdgeSwipeBack';
import { useEdgeSwipeForward } from '../native/useEdgeSwipeForward';
import { bumpRecentThread } from '../recent-threads/recentThreads';
import { resolveRecentThreadSummaryText } from '../recent-threads/recentThreadSummaryUtils';
import { lastExitedThreadAtom } from './lastExitedThread';
import {
  getRoomThreadExitTargetFromHistoryState,
  withRoomThreadExitTargetState,
} from './roomNavigateState';
import { createDefaultThreadFilterState, type ThreadFilterState } from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import { useRoomThreadSummaryState } from './threadSummaryStore';
import { useThreadRootEvent } from './useThreadRootEvent';
import { isConfirmedMatrixEventId, isLocalEchoEventId } from './threadRouteUtils';
import { useRoomViewMode } from './useRoomViewMode';

type UseRoomViewThreadStateOptions = {
  eventId?: string;
  room: Room;
  threadId?: string;
};

// The room has no thread filter controls, so a filter stored by an earlier build never applies.
const NO_THREAD_FILTER: ThreadFilterState = createDefaultThreadFilterState();

export type RoomViewThreadState = {
  effectiveThreadId?: string;
  handleExitThread: () => void;
  handleThreadRootDeleted: () => void;
  handleRoomMessageSent: (eventId: string) => boolean;
  handleViewModeChange: (mode: RoomViewMode) => void;
  storeThreadSummary: ReturnType<typeof useRoomThreadSummaryState>['storeThreadSummary'];
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  threadFilterState: ThreadFilterState;
  threadSummaryInfo?: MindroomThreadSummaryInfo;
  viewMode: RoomViewMode;
};

export const useRoomViewThreadState = ({
  eventId,
  room,
  threadId,
}: UseRoomViewThreadStateOptions): RoomViewThreadState => {
  const { roomId } = room;
  const t = useTranslation().t;
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), userId), [mx, userId]);
  const { navigatePath, navigateRoom, navigateRoomFocusEvent, navigateRoomThread } =
    useRoomNavigate();

  const { setViewMode, viewMode: effectiveViewMode } = useRoomViewMode(roomId);
  const lastExitedThread = useAtomValue(lastExitedThreadAtom);
  const setLastExitedThread = useSetAtom(lastExitedThreadAtom);
  const { summaryMap, storeThreadSummary } = useRoomThreadSummaryState({
    roomId,
    sessionId,
  });
  const threadRootId = useThreadRootEvent(room, threadId);
  const effectiveThreadId = threadRootId ?? threadId;
  const resolvedThreadRootEvent = effectiveThreadId
    ? room.getThread(effectiveThreadId)?.rootEvent ?? room.findEventById(effectiveThreadId)
    : undefined;
  const threadSummaryInfo = effectiveThreadId ? summaryMap.get(effectiveThreadId) : undefined;
  const recentThreadSummaryText = useMemo(
    () =>
      effectiveThreadId
        ? resolveRecentThreadSummaryText({
            room,
            threadRootId: effectiveThreadId,
            rootEvent: resolvedThreadRootEvent,
            summaryInfo: threadSummaryInfo,
            t,
          })
        : undefined,
    [effectiveThreadId, resolvedThreadRootEvent, room, t, threadSummaryInfo]
  );

  const leaveThread = useCallback(
    (fallback: () => void) => {
      const historyExitTarget = getRoomThreadExitTargetFromHistoryState(window.history.state);
      if (
        historyExitTarget?.roomId === roomId &&
        historyExitTarget.threadId === effectiveThreadId
      ) {
        const standaloneWebApp = isIOSStandaloneWebApp();
        if (historyExitTarget.exitPath && (!historyExitTarget.useHistoryBack || standaloneWebApp)) {
          navigatePath(historyExitTarget.exitPath, { replace: true });
          return;
        }
        if (historyExitTarget.useHistoryBack && !standaloneWebApp) {
          window.history.back();
          return;
        }
      }
      fallback();
    },
    [effectiveThreadId, navigatePath, roomId]
  );

  const handleExitThread = useCallback(() => {
    if (!effectiveThreadId) return;
    setLastExitedThread({ roomId, threadId: effectiveThreadId });
    leaveThread(() => navigateRoomFocusEvent(roomId, effectiveThreadId, { replace: true }));
  }, [effectiveThreadId, leaveThread, navigateRoomFocusEvent, roomId, setLastExitedThread]);

  // A deleted unsent root no longer exists, so swipe-forward must not reopen it and the
  // room must not try to focus it.
  const handleThreadRootDeleted = useCallback(
    () => leaveThread(() => navigateRoom(roomId, undefined, { replace: true })),
    [leaveThread, navigateRoom, roomId]
  );

  const handleSwipeForwardToThread = useCallback(() => {
    if (effectiveViewMode === 'classic') return;
    if (threadId) return;
    if (!lastExitedThread || lastExitedThread.roomId !== roomId) return;

    const targetThreadId = lastExitedThread.threadId;
    navigateRoomThread(roomId, targetThreadId);
    setLastExitedThread(null);
  }, [
    effectiveViewMode,
    lastExitedThread,
    navigateRoomThread,
    roomId,
    setLastExitedThread,
    threadId,
  ]);

  useEdgeSwipeBack(handleExitThread, effectiveViewMode !== 'classic' && !!threadId);
  useEdgeSwipeForward(
    handleSwipeForwardToThread,
    effectiveViewMode !== 'classic' && !threadId && lastExitedThread?.roomId === roomId
  );

  const handleViewModeChange = useCallback(
    (mode: RoomViewMode) => setViewMode(mode),
    [setViewMode]
  );

  const handleRoomMessageSent = useCallback(
    (sentEventId: string): boolean => {
      if (effectiveViewMode !== 'compact' || threadId || effectiveThreadId) return false;
      if (!isConfirmedMatrixEventId(sentEventId) && !isLocalEchoEventId(sentEventId)) return false;

      navigateRoomThread(roomId, sentEventId);
      return true;
    },
    [effectiveThreadId, effectiveViewMode, navigateRoomThread, roomId, threadId]
  );

  useEffect(() => {
    if (threadId) {
      setLastExitedThread(null);
      return;
    }

    if (lastExitedThread && lastExitedThread.roomId !== roomId) {
      setLastExitedThread(null);
    }
  }, [lastExitedThread, roomId, setLastExitedThread, threadId]);

  useEffect(() => () => setLastExitedThread(null), [setLastExitedThread]);

  useEffect(() => {
    if (!threadId || !effectiveThreadId || threadId === effectiveThreadId) return;

    const historyState: unknown = window.history.state;
    const historyExitTarget = getRoomThreadExitTargetFromHistoryState(historyState);
    let replacementState: Record<string, unknown> | undefined;
    if (historyExitTarget?.roomId === roomId && historyExitTarget.threadId === threadId) {
      const historyUserState =
        typeof historyState === 'object' && historyState !== null && 'usr' in historyState
          ? historyState.usr
          : undefined;
      replacementState = withRoomThreadExitTargetState(historyUserState, {
        ...historyExitTarget,
        threadId: effectiveThreadId,
      });
    }

    navigateRoomThread(roomId, effectiveThreadId, eventId, {
      replace: true,
      ...(replacementState ? { state: replacementState } : {}),
    });
  }, [effectiveThreadId, eventId, navigateRoomThread, roomId, threadId]);

  useEffect(() => {
    if (effectiveViewMode === 'classic' || !isConfirmedMatrixEventId(effectiveThreadId)) return;

    bumpRecentThread(roomId, effectiveThreadId, undefined, recentThreadSummaryText);
  }, [effectiveThreadId, effectiveViewMode, recentThreadSummaryText, roomId]);

  return {
    effectiveThreadId,
    handleExitThread,
    handleThreadRootDeleted,
    handleRoomMessageSent,
    handleViewModeChange,
    storeThreadSummary,
    summaryMap,
    threadFilterState: NO_THREAD_FILTER,
    threadSummaryInfo,
    viewMode: effectiveViewMode,
  };
};
