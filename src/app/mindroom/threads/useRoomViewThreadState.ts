import { useAtom } from 'jotai';
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
import { bumpRecentThread } from '../recent-threads/recentThreads';
import { resolveRecentThreadSummaryText } from '../recent-threads/recentThreadSummaryUtils';
import { getRoomThreadExitTargetFromHistoryState } from './roomNavigateState';
import {
  addTagFilter,
  applyPreset,
  cycleSortMode,
  cycleTagFilter,
  type FilterPreset,
  removeTagFilter,
  resetThreadFilterState,
  type ThreadFilterKey,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  updateThreadFilterKey,
} from './roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from './roomThreadFilterState';
import { roomViewModeAtomFamily, type RoomViewMode } from './roomViewMode';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
  serializeThreadFilterQuery,
} from './threadFilterDsl';
import { useRoomThreadSummaryState } from './threadSummaryStore';
import { useThreadRootEvent } from './useThreadRootEvent';

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
  const [threadSortFreezeState, setThreadSortFreezeState] =
    useState<ThreadSortFreezeState | null>(null);
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
    const historyExitTarget = getRoomThreadExitTargetFromHistoryState(window.history.state);
    if (
      historyExitTarget?.roomId === room.roomId &&
      historyExitTarget.threadId === effectiveThreadId
    ) {
      if (!historyExitTarget.useHistoryBack && historyExitTarget.exitPath) {
        navigatePath(historyExitTarget.exitPath, { replace: true });
        return;
      }
      if (historyExitTarget.useHistoryBack) {
        window.history.back();
        return;
      }
    }
    navigateRoomFocusEvent(room.roomId, effectiveThreadId, { replace: true });
  }, [effectiveThreadId, navigatePath, navigateRoomFocusEvent, room.roomId]);

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

  useEffect(() => {
    setThreadSortFreezeState(null);
  }, [roomId]);

  useEffect(() => {
    if (threadFilterState.sortBy === 'natural') {
      setThreadSortFreezeState(null);
    }
  }, [threadFilterState.sortBy]);

  useEffect(() => {
    if (!threadId || !effectiveThreadId || threadId === effectiveThreadId) return;

    navigateRoomThread(room.roomId, effectiveThreadId, eventId, { replace: true });
  }, [effectiveThreadId, eventId, navigateRoomThread, room.roomId, threadId]);

  useEffect(() => {
    if (!effectiveThreadId) return;

    bumpRecentThread(room.roomId, effectiveThreadId, undefined, recentThreadSummaryText);
  }, [effectiveThreadId, recentThreadSummaryText, room.roomId]);

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
    handleViewModeChange,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState,
    threadSortFreezeState,
    threadSummaryInfo,
    viewMode,
  };
};
