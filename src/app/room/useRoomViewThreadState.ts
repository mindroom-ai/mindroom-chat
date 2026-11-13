import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { createSessionId, getActiveSession } from '../matrix/session/sessions';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { isIOSStandaloneWebApp, isNativeIOS } from '../native/nativeSso';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { useEdgeSwipeForward } from '../navigation/useEdgeSwipeForward';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { bumpRecentThread } from '../event-store/threads/recentThreads';
import { resolveRecentThreadSummaryText } from '../event-store/threads/recentThreadSummaryUtils';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import {
  getRoomThreadExitTargetFromHistoryState,
  withRoomThreadExitTargetState,
} from '../routes/roomNavigateState';
import { historyPageOf, previousHistoryOrigin, showsRoom } from '../routes/historyStack';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import {
  addTagFilter,
  applyPreset,
  createDefaultThreadFilterState,
  cycleSortMode,
  type FilterPreset,
  normalizeThreadSearchText,
  removeTagFilter,
  resetThreadFilterState,
  simplifyAgentlessSimpleThreadFilterState,
  simplifyAgentlessThreadFilterState,
  simplifyThreadFilterState,
  type ThreadFilterKey,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  updateThreadFilterKey,
} from '../event-store/threads/roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from '../threads/overview/roomThreadFilterState';
import type { RoomViewMode } from '../navigation/roomViewMode';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
} from '../event-store/threads/threadFilterDsl';
import { useRoomThreadSummaryState } from '../event-store/threads/useRoomThreadSummaryState';
import { toggleThreadPerson } from '../event-store/threads/threadPeopleFilter';
import { useThreadRootEvent } from '../threads/useThreadRootEvent';
import {
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
} from '../event-store/threads/threadRouteUtils';
import { useRoomViewMode } from '../navigation/useRoomViewMode';

type UseRoomViewThreadStateOptions = {
  eventId?: string;
  hasMindroomAgents?: boolean;
  room: Room;
  threadId?: string;
};

export type RoomViewThreadState = {
  effectiveThreadId?: string;
  handleAddTag: (tag: string) => void;
  handleApplyPreset: (preset: FilterPreset) => void;
  handleClearPeople: () => void;
  handleClearTags: () => void;
  handleExitThread: () => void;
  handleThreadRootDeleted: () => void;
  handleRemoveTag: (tag: string) => void;
  handleReset: () => void;
  handleSearchQueryChange: (query: string) => void;
  handleSortDirectionChange: () => void;
  handleToggle: (key: ThreadFilterKey) => void;
  handleToggleThreadSortFreeze: () => void;
  handleToggleUnresolvedOnly: () => void;
  handleTogglePerson: (userId: string) => void;
  handleRoomMessageSent: (eventId: string) => boolean;
  handleViewModeChange: (mode: RoomViewMode) => void;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  storeThreadSummary: ReturnType<typeof useRoomThreadSummaryState>['storeThreadSummary'];
  summaryMap: Map<string, ThreadSummaryInfo>;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSummaryInfo?: ThreadSummaryInfo;
  viewMode: RoomViewMode;
};

export const useRoomViewThreadState = ({
  eventId,
  hasMindroomAgents = true,
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

  const { setViewMode, viewMode: effectiveViewMode } = useRoomViewMode(roomId, hasMindroomAgents);
  const threadFilterAtom = useMemo(
    () => roomThreadFilterAtomFamily(userId, roomId),
    [roomId, userId]
  );
  const [storedThreadFilterState, setThreadFilterState] = useAtom(threadFilterAtom);
  // Until the reader sets a filter in the room, Compact hides resolved threads.
  const threadFilterState = useMemo<ThreadFilterState>(
    () =>
      storedThreadFilterState ?? {
        ...createDefaultThreadFilterState(),
        resolved: effectiveViewMode === 'compact' ? 'exclude' : 'any',
      },
    [effectiveViewMode, storedThreadFilterState]
  );
  // Project stored filters onto the controls that are currently visible.
  // Persisted advanced filters must not keep hiding threads with no visible
  // cause, but remain stored so they can be restored when those controls
  // become available again.
  const [simpleMode] = useSetting(settingsAtom, 'simpleThreadFilters');
  const effectiveThreadFilterState = useMemo(() => {
    if (simpleMode) {
      return hasMindroomAgents
        ? simplifyThreadFilterState(threadFilterState)
        : simplifyAgentlessSimpleThreadFilterState(threadFilterState);
    }
    return hasMindroomAgents
      ? threadFilterState
      : simplifyAgentlessThreadFilterState(threadFilterState);
  }, [hasMindroomAgents, simpleMode, threadFilterState]);
  const lastExitedThread = useAtomValue(lastExitedThreadAtom);
  const setLastExitedThread = useSetAtom(lastExitedThreadAtom);
  const [threadSortFreezeState, setThreadSortFreezeState] = useState<ThreadSortFreezeState | null>(
    null
  );
  const effectiveThreadSortFreezeState =
    hasMindroomAgents && !simpleMode ? threadSortFreezeState : null;
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

  // Leaving a thread always leads to its room, wherever the thread was opened from (Activity,
  // search, another room's link). Opened from the room, it steps back to the room's own entry,
  // which keeps the room as it was left (on native iOS and in the iOS home screen app, the room's
  // path replaces the thread instead); from anywhere else, `toRoom` puts the room in the thread's
  // place, so the browser's back still returns to where the thread was opened from.
  const leaveThread = useCallback(
    (toRoom: () => void) => {
      const historyExitTarget = getRoomThreadExitTargetFromHistoryState(window.history.state);
      // Another account's way back, reached by a browser back step after a switch, leads to its
      // own pages.
      const recordedBy = historyExitTarget?.sessionId;
      const exitTarget =
        historyExitTarget?.roomId === roomId &&
        historyExitTarget.threadId === effectiveThreadId &&
        (recordedBy === undefined || recordedBy === getActiveSession()?.sessionId)
          ? historyExitTarget
          : undefined;
      const addresses = [roomId, getCanonicalAliasOrRoomId(mx, roomId)];
      // The page the thread was opened from, when the app has shown it; a redirect to the thread
      // may have replaced the entry that recorded it. After a reload, the exit target's path.
      const origin = previousHistoryOrigin(
        (page) =>
          !showsRoom(
            page,
            addresses,
            [threadId, effectiveThreadId].filter((id): id is string => !!id)
          )
      );
      const originPath = origin?.path ?? exitTarget?.exitPath;
      // The room itself, with no thread open in it.
      if (!originPath || !showsRoom(historyPageOf(originPath), addresses, [''])) {
        toRoom();
        return;
      }
      const historyBack =
        (exitTarget?.useHistoryBack ?? !isNativeIOS()) && !isIOSStandaloneWebApp();
      if (!historyBack) navigatePath(originPath, { replace: true });
      else if (!origin || origin.steps === 1) window.history.back();
      else window.history.go(-origin.steps);
    },
    [effectiveThreadId, mx, navigatePath, roomId, threadId]
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

  // A side panel in the conversation's place leaves the swipes to the page.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  const swipes = effectiveViewMode !== 'classic' && !behindPanel;
  useEdgeSwipeBack(handleExitThread, swipes && !!threadId);
  useEdgeSwipeForward(
    handleSwipeForwardToThread,
    swipes && !threadId && lastExitedThread?.roomId === roomId
  );

  // Typed queries apply on a pause, not per keystroke: structured tokens
  // (tag:/is:) parsed mid-word would otherwise refilter the overview with
  // transient one-letter filters ("u", "ur", …) and churn the sort-freeze
  // signature. The search input renders its own draft, so typing stays
  // responsive. Instant filter mutations (chips, presets, tags, sort) FLUSH
  // the pending query first and compose on top of it — the trailing timer
  // would otherwise clobber a click made inside the debounce window, since
  // applyParsedThreadFilterQuery rebuilds every DSL-owned dimension.
  const searchQueryDebounceRef = useRef<ReturnType<typeof globalThis.setTimeout>>();
  const pendingSearchQueryRef = useRef<string>();
  const threadFilterStateRef = useRef(threadFilterState);
  const hasMindroomAgentsRef = useRef(hasMindroomAgents);
  threadFilterStateRef.current = threadFilterState;
  hasMindroomAgentsRef.current = hasMindroomAgents;
  useEffect(() => () => globalThis.clearTimeout(searchQueryDebounceRef.current), []);

  const flushPendingSearchQuery = useCallback((): ThreadFilterState => {
    if (searchQueryDebounceRef.current !== undefined) {
      globalThis.clearTimeout(searchQueryDebounceRef.current);
      searchQueryDebounceRef.current = undefined;
    }
    const pendingQuery = pendingSearchQueryRef.current;
    pendingSearchQueryRef.current = undefined;
    if (pendingQuery === undefined) return threadFilterStateRef.current;
    const applied = hasMindroomAgentsRef.current
      ? applyParsedThreadFilterQuery(
          threadFilterStateRef.current,
          parseThreadFilterQuery(pendingQuery)
        )
      : {
          ...threadFilterStateRef.current,
          // With agent controls hidden, the retained search field is plain
          // text. Preserve agent filters in storage and treat is:/tag: tokens
          // literally instead of mutating invisible filter dimensions.
          freeText: normalizeThreadSearchText(pendingQuery),
          unsupportedQuery: '',
        };
    threadFilterStateRef.current = applied;
    setThreadFilterState(applied);
    return applied;
  }, [setThreadFilterState]);

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      globalThis.clearTimeout(searchQueryDebounceRef.current);
      pendingSearchQueryRef.current = query;
      searchQueryDebounceRef.current = globalThis.setTimeout(() => {
        searchQueryDebounceRef.current = undefined;
        flushPendingSearchQuery();
      }, 300);
    },
    [flushPendingSearchQuery]
  );

  const handleToggle = useCallback(
    (key: ThreadFilterKey) => {
      setThreadFilterState(updateThreadFilterKey(flushPendingSearchQuery(), key));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  // Simple mode's single binary control: unresolved-only on/off. Flips only
  // the resolved dimension so the hidden advanced dimensions survive in
  // storage. ('exclude' is the one resolved value the simple-mode projection
  // keeps, so flipping the raw value matches what the user sees.)
  const handleToggleUnresolvedOnly = useCallback(() => {
    const base = flushPendingSearchQuery();
    setThreadFilterState({
      ...base,
      resolved: base.resolved === 'exclude' ? 'any' : 'exclude',
    });
  }, [flushPendingSearchQuery, setThreadFilterState]);

  // The People filter: checks or unchecks one person.
  const handleTogglePerson = useCallback(
    (userId: string) => {
      const base = flushPendingSearchQuery();
      setThreadFilterState({ ...base, people: toggleThreadPerson(base.people, userId) });
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  // The Clear buttons of the People and Tags dropdowns: one change, so no choice survives.
  const handleClearPeople = useCallback(() => {
    setThreadFilterState({ ...flushPendingSearchQuery(), people: [] });
  }, [flushPendingSearchQuery, setThreadFilterState]);

  const handleClearTags = useCallback(() => {
    setThreadFilterState({ ...flushPendingSearchQuery(), tags: new Map() });
  }, [flushPendingSearchQuery, setThreadFilterState]);

  const handleSortDirectionChange = useCallback(() => {
    const base = flushPendingSearchQuery();
    setThreadFilterState({
      ...base,
      ...cycleSortMode(base),
    });
  }, [flushPendingSearchQuery, setThreadFilterState]);

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
    // Reset discards a pending typed query outright — flushing it first
    // would resurrect the filters the user is clearing.
    globalThis.clearTimeout(searchQueryDebounceRef.current);
    searchQueryDebounceRef.current = undefined;
    pendingSearchQueryRef.current = undefined;
    setThreadFilterState(resetThreadFilterState());
  }, [setThreadFilterState]);

  const handleAddTag = useCallback(
    (tag: string) => {
      setThreadFilterState(addTagFilter(flushPendingSearchQuery(), tag));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setThreadFilterState(removeTagFilter(flushPendingSearchQuery(), tag));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleApplyPreset = useCallback(
    (preset: FilterPreset) => {
      setThreadFilterState(applyPreset(flushPendingSearchQuery(), preset));
    },
    [flushPendingSearchQuery, setThreadFilterState]
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
    setThreadSortFreezeState(null);
  }, [roomId]);

  useEffect(() => {
    if (!hasMindroomAgents || simpleMode) {
      setThreadSortFreezeState(null);
    }
  }, [hasMindroomAgents, simpleMode]);

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
    handleAddTag,
    handleApplyPreset,
    handleClearPeople,
    handleClearTags,
    handleExitThread,
    handleThreadRootDeleted,
    handleRemoveTag,
    handleReset,
    handleSearchQueryChange,
    handleSortDirectionChange,
    handleToggle,
    handleToggleThreadSortFreeze,
    handleToggleUnresolvedOnly,
    handleTogglePerson,
    handleRoomMessageSent,
    handleViewModeChange,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState: effectiveThreadFilterState,
    threadSortFreezeState: effectiveThreadSortFreezeState,
    threadSummaryInfo,
    viewMode: effectiveViewMode,
  };
};
