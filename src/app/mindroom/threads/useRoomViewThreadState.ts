import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
import { getRoomThreadExitTargetFromHistoryState } from './roomNavigateState';
import {
  addTagFilter,
  applyPreset,
  cycleSortMode,
  cycleTagFilter,
  type FilterPreset,
  removeTagFilter,
  resetThreadFilterState,
  simplifyThreadFilterState,
  type ThreadFilterKey,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  updateThreadFilterKey,
} from './roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from './roomThreadFilterState';
import { DEFAULT_ROOM_VIEW_MODE, roomViewModeAtomFamily, type RoomViewMode } from './roomViewMode';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
  serializeThreadFilterQuery,
} from './threadFilterDsl';
import { useRoomThreadSummaryState } from './threadSummaryStore';
import { useThreadRootEvent } from './useThreadRootEvent';
import { isConfirmedMatrixEventId } from './threadRouteUtils';

type UseRoomViewThreadStateOptions = {
  eventId?: string;
  room: Room;
  threadId?: string;
};

export type RoomViewThreadState = {
  effectiveThreadId?: string;
  handleAddTag: (tag: string) => void;
  handleApplyPreset: (preset: FilterPreset) => void;
  handleCycleTag: (tag: string) => void;
  handleExitThread: () => void;
  handleRemoveTag: (tag: string) => void;
  handleReset: () => void;
  handleSearchQueryChange: (query: string) => void;
  handleSortDirectionChange: () => void;
  handleToggle: (key: ThreadFilterKey) => void;
  handleToggleThreadSortFreeze: () => void;
  handleToggleUnresolvedOnly: () => void;
  handleRoomMessageSent: (eventId: string) => void;
  handleViewModeChange: (mode: RoomViewMode) => void;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  storeThreadSummary: ReturnType<typeof useRoomThreadSummaryState>['storeThreadSummary'];
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSummaryInfo?: MindroomThreadSummaryInfo;
  viewMode: RoomViewMode;
};

export const useRoomViewThreadState = ({
  eventId,
  room,
  threadId,
}: UseRoomViewThreadStateOptions): RoomViewThreadState => {
  const { roomId } = room;
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), userId), [mx, userId]);
  const { navigatePath, navigateRoomFocusEvent, navigateRoomThread } = useRoomNavigate();

  const roomViewModeAtom = roomViewModeAtomFamily(roomId);
  const [viewMode, setViewMode] = useAtom(roomViewModeAtom);
  const threadFilterAtom = useMemo(
    () => roomThreadFilterAtomFamily(userId, roomId),
    [roomId, userId]
  );
  const [threadFilterState, setThreadFilterState] = useAtom(threadFilterAtom);
  // Simple mode hides every filter control except the unresolved toggle, so
  // the state handed to the view is projected onto that subspace — persisted
  // advanced filters must not keep hiding threads with no visible cause. The
  // stored state is untouched; leaving simple mode restores it.
  const simpleMode = useSimpleMode();
  const effectiveThreadFilterState = useMemo(
    () => (simpleMode ? simplifyThreadFilterState(threadFilterState) : threadFilterState),
    [simpleMode, threadFilterState]
  );
  const lastExitedThread = useAtomValue(lastExitedThreadAtom);
  const setLastExitedThread = useSetAtom(lastExitedThreadAtom);
  const [threadSortFreezeState, setThreadSortFreezeState] = useState<ThreadSortFreezeState | null>(
    null
  );
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
          })
        : undefined,
    [effectiveThreadId, resolvedThreadRootEvent, room, threadSummaryInfo]
  );

  const handleExitThread = useCallback(() => {
    if (!effectiveThreadId) return;
    setLastExitedThread({ roomId, threadId: effectiveThreadId });
    const historyExitTarget = getRoomThreadExitTargetFromHistoryState(window.history.state);
    if (historyExitTarget?.roomId === roomId && historyExitTarget.threadId === effectiveThreadId) {
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
    navigateRoomFocusEvent(roomId, effectiveThreadId, { replace: true });
  }, [effectiveThreadId, navigatePath, navigateRoomFocusEvent, roomId, setLastExitedThread]);

  const handleSwipeForwardToThread = useCallback(() => {
    if (viewMode === 'classic') return;
    if (threadId) return;
    if (!lastExitedThread || lastExitedThread.roomId !== roomId) return;

    const targetThreadId = lastExitedThread.threadId;
    navigateRoomThread(roomId, targetThreadId);
    setLastExitedThread(null);
  }, [lastExitedThread, navigateRoomThread, roomId, setLastExitedThread, threadId, viewMode]);

  useEdgeSwipeBack(handleExitThread, viewMode !== 'classic' && !!threadId);
  useEdgeSwipeForward(
    handleSwipeForwardToThread,
    viewMode !== 'classic' && !threadId && lastExitedThread?.roomId === roomId
  );

  const updateFromEffectiveQueryState = useCallback(
    (updater: (state: ThreadFilterState) => ThreadFilterState) => {
      const next = updater(
        applyParsedThreadFilterQuery(
          threadFilterState,
          parseThreadFilterQuery(threadFilterState.searchQuery ?? '')
        )
      );
      const searchQuery = serializeThreadFilterQuery(next);
      setThreadFilterState(
        searchQuery === threadFilterState.searchQuery ? next : { ...next, searchQuery }
      );
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleToggle = useCallback(
    (key: ThreadFilterKey) => {
      updateFromEffectiveQueryState((state) => updateThreadFilterKey(state, key));
    },
    [updateFromEffectiveQueryState]
  );

  // Simple mode's single binary control: unresolved-only on/off. Flips only
  // the resolved dimension so the hidden advanced dimensions survive in
  // storage. ('exclude' is the one resolved value the simple-mode projection
  // keeps, so flipping the raw value matches what the user sees.)
  const handleToggleUnresolvedOnly = useCallback(() => {
    updateFromEffectiveQueryState((state) => ({
      ...state,
      resolved: state.resolved === 'exclude' ? 'any' : 'exclude',
    }));
  }, [updateFromEffectiveQueryState]);

  const handleSortDirectionChange = useCallback(() => {
    setThreadFilterState({
      ...threadFilterState,
      ...cycleSortMode(threadFilterState),
    });
  }, [setThreadFilterState, threadFilterState]);

  const handleToggleThreadSortFreeze = useCallback(() => {
    setThreadSortFreezeState((currentState) =>
      currentState
        ? null
        : {
            controlSignature: null,
            orderedRootIds: [],
          }
    );
  }, []);

  const handleReset = useCallback(() => {
    setThreadFilterState(resetThreadFilterState());
  }, [setThreadFilterState]);

  const handleCycleTag = useCallback(
    (tag: string) => {
      updateFromEffectiveQueryState((state) => cycleTagFilter(state, tag));
    },
    [updateFromEffectiveQueryState]
  );

  const handleAddTag = useCallback(
    (tag: string) => {
      updateFromEffectiveQueryState((state) => addTagFilter(state, tag));
    },
    [updateFromEffectiveQueryState]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      updateFromEffectiveQueryState((state) => removeTagFilter(state, tag));
    },
    [updateFromEffectiveQueryState]
  );

  const handleApplyPreset = useCallback(
    (preset: FilterPreset) => {
      updateFromEffectiveQueryState((state) => applyPreset(state, preset));
    },
    [updateFromEffectiveQueryState]
  );

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setThreadFilterState({
        ...threadFilterState,
        searchQuery: query,
      });
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleViewModeChange = useCallback(
    (mode: RoomViewMode) => setViewMode(mode),
    [setViewMode]
  );

  const handleRoomMessageSent = useCallback(
    (sentEventId: string) => {
      if (viewMode !== 'compact' || threadId || effectiveThreadId) return;
      if (!isConfirmedMatrixEventId(sentEventId)) return;

      navigateRoomThread(roomId, sentEventId);
    },
    [effectiveThreadId, navigateRoomThread, roomId, threadId, viewMode]
  );

  useEffect(() => {
    setThreadSortFreezeState(null);
  }, [roomId]);

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
    if (threadFilterState.sortBy === 'natural') {
      setThreadSortFreezeState(null);
    }
  }, [threadFilterState.sortBy]);

  useEffect(() => {
    if (!threadId || !effectiveThreadId || threadId === effectiveThreadId) return;

    navigateRoomThread(roomId, effectiveThreadId, eventId, { replace: true });
  }, [effectiveThreadId, eventId, navigateRoomThread, roomId, threadId]);

  useEffect(() => {
    if (viewMode === 'classic' || !isConfirmedMatrixEventId(effectiveThreadId)) return;

    bumpRecentThread(roomId, effectiveThreadId, undefined, recentThreadSummaryText);
  }, [effectiveThreadId, recentThreadSummaryText, roomId, viewMode]);

  return {
    effectiveThreadId,
    handleAddTag,
    handleApplyPreset,
    handleCycleTag,
    handleExitThread,
    handleRemoveTag,
    handleReset,
    handleSearchQueryChange,
    handleSortDirectionChange,
    handleToggle,
    handleToggleThreadSortFreeze,
    handleToggleUnresolvedOnly,
    handleRoomMessageSent,
    handleViewModeChange,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState: effectiveThreadFilterState,
    threadSortFreezeState,
    threadSummaryInfo,
    // The view-mode toggles are hidden in simple mode, so a persisted
    // non-default choice must not stick either.
    viewMode: simpleMode ? DEFAULT_ROOM_VIEW_MODE : viewMode,
  };
};
