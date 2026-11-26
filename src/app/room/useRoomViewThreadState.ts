import type { ThreadWorkflowTab } from '../event-store/threads/threadWorkflow';
import { selectThreadWorkflowTab } from '../event-store/threads/roomThreadOverviewModel';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UNSAFE_LocationContext } from 'react-router-dom';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { createSessionId, getActiveSession } from '../matrix/session/sessions';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { isIOSStandaloneWebApp, isNativeIOS } from '../native/nativeSso';
import { SWIPE_PRIORITY } from '../navigation/interactiveSwipe';
import {
  clearActivePhoneSwipeContext,
  createThreadBackSwipeScene,
  createThreadForwardSwipeScene,
  getCurrentPhoneLocationKey,
  type LiveThreadBackUnder,
  rekeyPhoneSwipePreviewThread,
  setActivePhoneSwipeContext,
} from '../navigation/phonePageSlide';
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
import {
  currentHistoryLocation,
  historyPageOf,
  isSpaceThreadsPage,
  previousHistoryOrigin,
  RETURN_TO_ROOM_STATE,
  roomFocusEventOf,
  showsRoom,
} from '../routes/historyStack';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import {
  addTagFilter,
  applyThreadSearchQuery,
  createDefaultThreadFilterState,
  cycleSortMode,
  projectThreadFilterState,
  removeTagFilter,
  resetThreadFilterState,
  type ThreadFilterState,
  type ThreadSortFreezeState,
} from '../event-store/threads/roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from '../threads/overview/roomThreadFilterState';
import { getCompactRoomSectionsAtom } from '../threads/overview/compactRoomSections';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { useRoomThreadSummaryState } from '../event-store/threads/useRoomThreadSummaryState';
import { toggleThreadPerson } from '../event-store/threads/threadPeopleFilter';
import { useThreadRootEvent } from '../threads/useThreadRootEvent';
import {
  findThreadRoom,
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
} from '../event-store/threads/threadRouteUtils';
import { loadLatestCachedThreadEvents } from '../event-store/cache/eventRepository';
import { useViewScopedState } from '../timeline/roomTimelineViewScope';
import { useRoomViewMode } from '../navigation/useRoomViewMode';

export type LiveRoomPeekFocus = {
  eventId: string;
  onlyIfUnsaved?: boolean;
};

type UseRoomViewThreadStateOptions = {
  enterLiveRoomPeek?: (peekFocus?: LiveRoomPeekFocus) => LiveThreadBackUnder | null;
  eventId?: string;
  hasMindroomAgents?: boolean;
  room: Room;
  threadId?: string;
};

export type RoomViewThreadState = {
  effectiveThreadId?: string;
  handleAddTag: (tag: string) => void;
  handleSelectTab: (tab: ThreadWorkflowTab) => void;
  handleShowSnoozed: () => void;
  handleClearPeople: () => void;
  handleClearTags: () => void;
  handleExitThread: () => void;
  handleOpenThread: (threadId: string) => void;
  handleThreadRootDeleted: () => void;
  /** The open thread failed to load in this room (`ThreadView`'s `onThreadLoadError`). */
  handleThreadLoadError: (threadId: string) => void;
  handleRemoveTag: (tag: string) => void;
  handleReset: () => void;
  handleSearchQueryChange: (query: string) => void;
  handleSortDirectionChange: () => void;
  handleToggleThreadSortFreeze: () => void;
  /** Turns Compact's Sections on or off, for every room of the account. */
  handleToggleThreadSections: () => void;
  handleToggleUnresolvedOnly: () => void;
  handleToggleForMe: () => void;
  handleTogglePerson: (userId: string) => void;
  handleRoomMessageSent: (eventId: string) => boolean;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  storeThreadSummary: ReturnType<typeof useRoomThreadSummaryState>['storeThreadSummary'];
  summaryMap: Map<string, ThreadSummaryInfo>;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSummaryInfo?: ThreadSummaryInfo;
  /** Compact shows its cards in sections: Needs you, Working, Later and Done. */
  threadSections: boolean;
  /** The open thread is not in this room, and no joined room the client knows holds it. */
  threadNotFound: boolean;
  viewMode: RoomViewMode;
};

export const useRoomViewThreadState = ({
  enterLiveRoomPeek,
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
  const {
    navigatePath,
    navigateRoom,
    navigateRoomFocusEvent,
    navigateRoomThread,
    navigateRoomThreadDirect,
  } = useRoomNavigate();

  const { viewMode: effectiveViewMode } = useRoomViewMode(roomId, hasMindroomAgents);
  const threadFilterAtom = useMemo(
    () => roomThreadFilterAtomFamily(userId, roomId),
    [roomId, userId]
  );
  const [storedThreadFilterState, setThreadFilterState] = useAtom(threadFilterAtom);
  const [simpleMode] = useSetting(settingsAtom, 'simpleThreadFilters');
  // New advanced agent rooms start on Needs you; Simple mode keeps its existing default.
  const threadFilterState = useMemo<ThreadFilterState>(() => {
    if (storedThreadFilterState) return storedThreadFilterState;
    const defaults = createDefaultThreadFilterState();
    if (hasMindroomAgents && !simpleMode && effectiveViewMode === 'compact')
      return selectThreadWorkflowTab(defaults, 'needsYou');
    return {
      ...defaults,
      resolved: effectiveViewMode === 'compact' ? 'exclude' : 'any',
      snoozed: effectiveViewMode === 'compact' ? 'exclude' : 'any',
    };
  }, [effectiveViewMode, storedThreadFilterState, hasMindroomAgents, simpleMode]);
  // Project stored filters onto the controls that are currently visible.
  // Persisted advanced filters must not keep hiding threads with no visible
  // cause, but remain stored so they can be restored when those controls
  // become available again.
  const effectiveThreadFilterState = useMemo(
    () => projectThreadFilterState(threadFilterState, simpleMode, hasMindroomAgents),
    [hasMindroomAgents, simpleMode, threadFilterState]
  );
  const [compactSections, updateCompactSections] = useAtom(
    useMemo(() => getCompactRoomSectionsAtom(userId), [userId])
  );
  // Only agent rooms have the workflow buckets; a room without agents keeps its cards' sort.
  const threadSections = effectiveViewMode === 'compact' && hasMindroomAgents && compactSections.on;
  const lastExitedThread = useAtomValue(lastExitedThreadAtom);
  const setLastExitedThread = useSetAtom(lastExitedThreadAtom);
  const [threadSortFreezeState, setThreadSortFreezeState] = useState<ThreadSortFreezeState | null>(
    null
  );
  const effectiveThreadSortFreezeState =
    hasMindroomAgents && !simpleMode && !threadSections ? threadSortFreezeState : null;
  const { summaryMap, storeThreadSummary } = useRoomThreadSummaryState({
    roomId,
    sessionId,
  });
  const threadRootId = useThreadRootEvent(room, threadId);
  const effectiveThreadId = threadRootId ?? threadId;
  const resolvedThreadRootEvent = effectiveThreadId
    ? (room.getThread(effectiveThreadId)?.rootEvent ?? room.findEventById(effectiveThreadId))
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

  // Leaving a thread leads to its room, except when opened from a space's All threads overview,
  // where it returns there with the overview's selection intact. Opened from the room or Space All
  // threads, it steps back to that entry (on native iOS and in the iOS home screen app, the origin
  // path replaces the thread instead); from anywhere else (Activity, search, another room's link),
  // `toRoom` puts the room in the thread's place, so the browser's back still returns to where the
  // thread was opened from.
  const location = useContext(UNSAFE_LocationContext)?.location;
  const locationKey = location?.key;
  const locationState: unknown = location?.state;

  const resolveThreadExit = useCallback(() => {
    if (!effectiveThreadId) return { returnsToRoom: false, returnsToSpaceThreads: false };
    const browserHistoryState: unknown =
      typeof window !== 'undefined' ? (window as Partial<Window>).history?.state : undefined;
    const historyExitTarget =
      (locationKey !== undefined || locationState !== undefined
        ? getRoomThreadExitTargetFromHistoryState({ key: locationKey, usr: locationState })
        : undefined) ?? getRoomThreadExitTargetFromHistoryState(browserHistoryState);
    // Another account's way back, reached by a browser back step after a switch, leads to its
    // own pages.
    const recordedBy = historyExitTarget?.sessionId;
    const activeSessionId = getActiveSession()?.sessionId ?? sessionId;
    const exitTarget =
      historyExitTarget?.roomId === roomId &&
      (historyExitTarget.threadId === effectiveThreadId ||
        historyExitTarget.threadId === threadId) &&
      (recordedBy === undefined || recordedBy === activeSessionId)
        ? historyExitTarget
        : undefined;
    const addresses = [roomId, getCanonicalAliasOrRoomId(mx, roomId)];
    const threadIds = [threadId, effectiveThreadId].filter((id): id is string => !!id);
    // The page the thread was opened from, when the app has shown it; a redirect to the thread
    // may have replaced the entry that recorded it. Before the history recorder's passive effect
    // records a newly mounted thread, fall back to the exit target recorded on the location.
    const currentEntry = currentHistoryLocation();
    const origin =
      currentEntry && showsRoom(currentEntry, addresses, threadIds)
        ? previousHistoryOrigin((page) => !showsRoom(page, addresses, threadIds))
        : undefined;
    const originPath = origin?.path ?? exitTarget?.exitPath;
    if (!originPath) {
      return { exitTarget, origin, returnsToRoom: false, returnsToSpaceThreads: false };
    }
    const originPage = historyPageOf(originPath);
    const returnsToRoom = showsRoom(originPage, addresses, ['']);
    const originFocusEventId = returnsToRoom ? roomFocusEventOf(originPage) : undefined;
    const openedForOrigin = origin
      ? origin.returnToOrigin === true
      : exitTarget?.returnToOrigin === true;
    const returnsToSpaceThreads = openedForOrigin && isSpaceThreadsPage(originPage);
    return {
      exitTarget,
      origin,
      originFocusEventId,
      originPath,
      returnsToRoom,
      returnsToSpaceThreads,
    };
  }, [effectiveThreadId, locationKey, locationState, mx, roomId, sessionId, threadId]);

  const leaveThread = useCallback(
    (toRoom: () => void) => {
      const { exitTarget, origin, originPath, returnsToRoom, returnsToSpaceThreads } =
        resolveThreadExit();
      // The room itself (with no thread open in it) or the Space All threads page that opened it.
      if (!originPath || (!returnsToRoom && !returnsToSpaceThreads)) {
        toRoom();
        return;
      }
      const historyBack =
        (exitTarget?.useHistoryBack ?? !isNativeIOS()) && !isIOSStandaloneWebApp();
      if (!historyBack) {
        navigatePath(originPath, {
          replace: true,
          ...(returnsToRoom ? { state: RETURN_TO_ROOM_STATE } : {}),
        });
      } else if (!origin || origin.steps === 1) window.history.back();
      else window.history.go(-origin.steps);
    },
    [navigatePath, resolveThreadExit]
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

  // An event is its room's, so a thread whose event another joined room holds is that room's:
  // a thread that does not load here opens there, in place of this address. A thread no joined
  // room holds and of which this room's event cache holds nothing either shows as not found until
  // it is left; one the cache holds rows of stays, as its rows still show.
  const [missingThreadId, setMissingThreadId] = useViewScopedState<string | undefined>(
    `${roomId}|${effectiveThreadId ?? ''}`,
    () => undefined
  );
  const threadNotFound = !!effectiveThreadId && missingThreadId === effectiveThreadId;
  const handleThreadLoadError = useCallback(
    (failedThreadId: string) => {
      const threadRoom = findThreadRoom(mx.getRooms(), failedThreadId);
      if (threadRoom) {
        navigateRoomThreadDirect(threadRoom.roomId, failedThreadId, eventId, { replace: true });
        return;
      }
      loadLatestCachedThreadEvents(sessionId, roomId, failedThreadId, 1)
        .then((page) => {
          if (!page.rootEvent && page.events.length === 0) setMissingThreadId(failedThreadId);
        })
        .catch(() => setMissingThreadId(failedThreadId));
    },
    [eventId, mx, navigateRoomThreadDirect, roomId, sessionId, setMissingThreadId]
  );

  const handleOpenThread = useCallback(
    (openedThreadId: string) => navigateRoomThread(roomId, openedThreadId),
    [navigateRoomThread, roomId]
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

  useLayoutEffect(() => {
    if (threadId && effectiveThreadId && threadId !== effectiveThreadId) {
      rekeyPhoneSwipePreviewThread('room', { sessionId, roomId, threadId }, effectiveThreadId);
    }
    const context = { sessionId, roomId, threadId: effectiveThreadId };
    setActivePhoneSwipeContext(context);
    return () => clearActivePhoneSwipeContext(context);
  }, [effectiveThreadId, roomId, sessionId, threadId]);

  const resolveFromLocationKey = useCallback(
    () =>
      locationKey ??
      getCurrentPhoneLocationKey() ??
      (window.history.state as { key?: string } | null)?.key ??
      '',
    [locationKey]
  );

  const enterLiveRoomPeekRef = useLatestRef(enterLiveRoomPeek);

  const beginThreadBackSwipe = useCallback(
    ({ dirSign }: { dirSign: 1 | -1 }) => {
      if (!effectiveThreadId) return null;
      const { originFocusEventId, returnsToRoom, returnsToSpaceThreads } = resolveThreadExit();
      const peekFocus: LiveRoomPeekFocus | undefined = !returnsToRoom
        ? { eventId: effectiveThreadId }
        : originFocusEventId
          ? { eventId: originFocusEventId, onlyIfUnsaved: true }
          : undefined;
      return createThreadBackSwipeScene({
        key: { sessionId, roomId, threadId: effectiveThreadId },
        fromLocationKey: resolveFromLocationKey(),
        onCommit: handleExitThread,
        dirSign,
        enterLiveUnder: returnsToSpaceThreads
          ? undefined
          : () => enterLiveRoomPeekRef.current?.(peekFocus) ?? null,
      });
    },
    [
      effectiveThreadId,
      enterLiveRoomPeekRef,
      handleExitThread,
      resolveFromLocationKey,
      resolveThreadExit,
      roomId,
      sessionId,
    ]
  );

  const beginThreadForwardSwipe = useCallback(
    ({ dirSign }: { dirSign: 1 | -1 }) => {
      if (!lastExitedThread || lastExitedThread.roomId !== roomId) return null;
      return createThreadForwardSwipeScene({
        key: { sessionId, roomId, threadId: lastExitedThread.threadId },
        fromLocationKey: resolveFromLocationKey(),
        onCommit: handleSwipeForwardToThread,
        dirSign,
      });
    },
    [handleSwipeForwardToThread, lastExitedThread, resolveFromLocationKey, roomId, sessionId]
  );

  // A side panel in the conversation's place leaves the swipes to the page.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  const swipes = effectiveViewMode !== 'classic' && !behindPanel;
  useEdgeSwipeBack(handleExitThread, swipes && !!threadId, {
    priority: SWIPE_PRIORITY.PAGE,
    begin: beginThreadBackSwipe,
  });
  useEdgeSwipeForward(
    handleSwipeForwardToThread,
    swipes && !threadId && lastExitedThread?.roomId === roomId,
    {
      priority: SWIPE_PRIORITY.PAGE,
      begin: beginThreadForwardSwipe,
    }
  );

  // Typed queries apply on a pause, not per keystroke: structured tokens
  // (tag:/is:) parsed mid-word would otherwise refilter the overview with
  // transient one-letter filters ("u", "ur", …) and churn the sort-freeze
  // signature. The search input renders its own draft, so typing stays
  // responsive. Instant filter mutations (tabs, people, tags, sort) FLUSH
  // the pending query first and compose on top of it — the trailing timer
  // would otherwise clobber a click made inside the debounce window, since
  // applyParsedThreadFilterQuery rebuilds every DSL-owned dimension.
  const searchQueryDebounceRef = useRef<ReturnType<typeof globalThis.setTimeout>>(undefined);
  const pendingSearchQueryRef = useRef<string>(undefined);
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
    const applied = applyThreadSearchQuery(
      threadFilterStateRef.current,
      pendingQuery,
      hasMindroomAgentsRef.current
    );
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

  // The simple-mode projection keeps only the exclusion. Leave hidden filters stored.
  const handleToggleUnresolvedOnly = useCallback(() => {
    const base = flushPendingSearchQuery();
    setThreadFilterState({
      ...base,
      resolved: base.resolved === 'exclude' ? 'any' : 'exclude',
    });
  }, [flushPendingSearchQuery, setThreadFilterState]);

  const handleToggleForMe = useCallback(() => {
    const base = flushPendingSearchQuery();
    setThreadFilterState({ ...base, forMe: !base.forMe });
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

  const handleToggleThreadSections = useCallback(() => {
    updateCompactSections({ type: 'SET_ON', on: !compactSections.on });
  }, [compactSections.on, updateCompactSections]);

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

  const handleSelectTab = useCallback(
    (tab: ThreadWorkflowTab) => {
      setThreadFilterState(selectThreadWorkflowTab(flushPendingSearchQuery(), tab));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleShowSnoozed = useCallback(() => {
    const base = flushPendingSearchQuery();
    if (!simpleMode && hasMindroomAgents) {
      setThreadFilterState(selectThreadWorkflowTab(base, 'later'));
      return;
    }
    setThreadFilterState({ ...base, snoozed: 'any' });
  }, [flushPendingSearchQuery, hasMindroomAgents, setThreadFilterState, simpleMode]);

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

  // A thread that opens ends the record of the one left before it. Only as it opens: leaving
  // records the thread while its address still names it, until the browser has stepped back.
  useEffect(() => {
    if (threadId) setLastExitedThread(null);
  }, [setLastExitedThread, threadId]);
  useEffect(() => {
    if (lastExitedThread && lastExitedThread.roomId !== roomId) {
      setLastExitedThread(null);
    }
  }, [lastExitedThread, roomId, setLastExitedThread]);

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
    // An address that pairs the room with another room's thread leaves no entry.
    const threadRoom = findThreadRoom(mx.getRooms(), effectiveThreadId);
    if (threadRoom && threadRoom.roomId !== roomId) return;

    bumpRecentThread(roomId, effectiveThreadId, undefined, recentThreadSummaryText);
  }, [effectiveThreadId, effectiveViewMode, mx, recentThreadSummaryText, roomId]);

  return {
    effectiveThreadId,
    handleAddTag,
    handleSelectTab,
    handleShowSnoozed,
    handleClearPeople,
    handleClearTags,
    handleExitThread,
    handleOpenThread,
    handleThreadRootDeleted,
    handleThreadLoadError,
    handleRemoveTag,
    handleReset,
    handleSearchQueryChange,
    handleSortDirectionChange,
    handleToggleThreadSortFreeze,
    handleToggleThreadSections,
    handleToggleUnresolvedOnly,
    handleToggleForMe,
    handleTogglePerson,
    handleRoomMessageSent,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState: effectiveThreadFilterState,
    threadSortFreezeState: effectiveThreadSortFreezeState,
    threadSummaryInfo,
    threadSections,
    threadNotFound,
    viewMode: effectiveViewMode,
  };
};
