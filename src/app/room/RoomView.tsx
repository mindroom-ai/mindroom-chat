import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { useEditor } from '../editor/Editor';
import { Button, Icon, Icons, Text } from 'folds';
import { Page, PageHero, PageHeroSection } from '../ui/page/Page';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { editableActiveElement } from '../lib/dom';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';
import { RoomInput } from '../composer/RoomInput';
import { moveMessageDraft } from '../composer/roomInputDrafts';
import { computerOwnsKeyboardEvent } from '../computer/computerFocus';
import { useSyncEngine } from '../event-store/engine/engineContext';
import type { ScrollAnchorMemory } from '../ui/scrollAnchorMemory';
import type { RoomRowsPlace } from '../timeline/roomTimelineScroll';
import { RoomTimeline, type RoomTimelineProps } from '../timeline/RoomTimeline';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import { RoomHeaderSlot } from './RoomHeaderSlot';
import { ConversationCover } from './ConversationCover';
import {
  conversationBehindPanelAtom,
  conversationHiddenAtom,
  conversationUnderThreadAtom,
} from '../navigation/conversationCover';
import { useInert } from '../lib/hooks/useInert';
import { ROOM_MESSAGES_VIEW, useShownConversationView } from '../navigation/conversationView';
import {
  CONVERSATION_MIN_WIDTH,
  ResizablePanel,
  SIDE_PANEL_MAX_WIDTH,
} from '../ui/panels/ResizablePanel';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import { CrossRoomForkDraftBanner } from '../threads/fork/CrossRoomForkDraftBanner';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { isEventId } from '../lib/matrixIds';
import {
  canPlayLiveSlide,
  completeLiveSlideHandoff,
  playLiveSlide,
  SWIPE_THREAD_STAGE,
  SWIPE_UNDER_THREAD,
  type LiveThreadBackUnder,
} from '../navigation/phonePageSlide';
import { useSpaceUnderLayer } from '../spaces/spaceUnderLayerContext';
import { useRoomViewThreadState, type LiveRoomPeekFocus } from './useRoomViewThreadState';
import { useShortcut } from '../shortcuts/useShortcut';
import { ThreadView } from './ThreadView';
import { ComposerNotice, ConversationLayout } from './ConversationLayout';
import { useLocalEchoRoot } from './useLocalEchoRoot';
import { isThreadColumnKey, noteThreadColumnKey } from './useRoomEscapeReadReceipts';
import { useThreadKeys } from './useThreadKeys';
import { focusOwnsTyping, isPasteKey, isTypingKey } from './typeToCompose';
import { THREAD_COLUMN_WIDTH_KEY, useThreadLayout } from './threadLayout';

const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';
const NOOP = () => undefined;
/** The thread column opens this wide, and may take what the messages beside it can spare. */
const THREAD_COLUMN_DEFAULT_WIDTH = 480;
// The page's own style (Page), and with the thread column beside the room area.
const PAGE_STYLE: CSSProperties = { minHeight: 0, minWidth: 0 };
const PAGE_ROW_STYLE: CSSProperties = { ...PAGE_STYLE, flexDirection: 'row' };

// The column holds the thread's view, and takes the files dropped anywhere on it.
const COLUMN_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
};

export type RoomViewProps = Omit<
  RoomViewHeaderProps,
  'threadId' | 'threadFilterState' | 'passive'
> & {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** The open thread is a fork draft from this message of it (`ThreadView`). */
  forkAt?: string;
  /** Validated cross-room fork draft to show in the thread column (`ThreadView`). */
  crossRoomFork?: { sourceRoom: Room; threadId: string; forkAt: string };
  /** Back action for an open cross-room fork draft. */
  onExitCrossRoomFork?: () => void;
  /** The route asks to show `eventId` in the room timeline rather than in its thread. */
  focusEventInRoom?: boolean;
  /** The router's key of the history entry whose address this is. */
  entryKey?: string;
  /** Whether the router pushed that entry (a link followed), not replaced or returned to it. */
  entryPushed?: boolean;
  /** Whether the app's Back put that entry in a thread's place (`RETURN_TO_ROOM_STATE`). */
  entryReturned?: boolean;
  onThreadLoadError?: (threadId: string) => void;
  /**
   * A second thread shows beside the page (Open in second column): the open thread then goes
   * beside the room's messages while the page has room, whatever layout is stored.
   */
  besideWhileSecond?: boolean;
};

/**
 * Typing a letter or digit with nothing focused starts a message in the composer, pasting there
 * (Cmd+V or Ctrl+V, with Shift too) pastes into it, and Escape outside a field or menu goes back
 * to it (the room's Escape handler reads its main timeline, or the open thread, as well). The
 * paste key only moves the focus: the browser's paste that follows the keydown then goes to the
 * composer, which takes its text and files as any paste into it. None of them takes a key that a
 * handler cancelled (`preventDefault`) before it reached the window, nor a key pressed inside an
 * element marked `data-keeps-typing`: a region that reads keys without a text field (a game, a
 * drawing surface) carries it.
 */
const useTypeToCompose = (focusComposer: (evt: KeyboardEvent) => boolean, enabled: boolean) => {
  const handleKey = useCallback(
    (evt: KeyboardEvent) => {
      if (!enabled || evt.defaultPrevented) return;
      if (!isTypingKey(evt) && !isPasteKey(evt)) return;
      // The agent's computer screen takes its own keystrokes.
      if (computerOwnsKeyboardEvent(evt) || editableActiveElement() || focusOwnsTyping()) return;
      focusComposer(evt);
    },
    [enabled, focusComposer]
  );
  useKeyDown(window, handleKey);
  useShortcut('focusComposer', (evt) => {
    if (!enabled || focusOwnsTyping()) return false;
    return focusComposer(evt);
  });
};

/**
 * The main area of a room: the room's own messages (Compact cards or the Full timeline) under a
 * floating header and footer, with background jobs above the composer (`ConversationLayout`), and
 * the open thread in a column of its own (`ThreadView`, with its own composer), beside the
 * messages where the person chose it and the page has room (`useThreadLayout`), else filling the
 * page. Filling it, the column shows the room's header and the room's conversation goes from under
 * it; its rows keep their place for the way back. Show beside and Show in full change only the
 * column's width, so a thread never moves between composers.
 */
export function RoomView({
  room,
  eventId,
  threadId,
  forkAt,
  crossRoomFork,
  onExitCrossRoomFork,
  focusEventInRoom,
  entryKey,
  entryPushed,
  entryReturned,
  hasMindroomAgents,
  onThreadLoadError,
  besideWhileSecond = false,
  ...headerProps
}: RoomViewProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const editor = useEditor();
  const engine = useSyncEngine();
  const { roomId } = room;
  const areaRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const compactRoomScrollStateRef = useRef<ScrollAnchorMemory>(new Map());
  const threadReturnPlaceRef = useRef<RoomRowsPlace>(undefined);

  const myUserId = client.getSafeUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const canMessage = permissions.event('m.room.message', myUserId);
  // Cancelling a background job sends an event, so it takes that event's power level.
  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, myUserId);

  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const spaceUnderLayer = useSpaceUnderLayer();
  const [peekingRoom, setPeekingRoom] = useState<{ focusEventId?: string } | null>(null);
  const [peekingForwardThreadId, setPeekingForwardThreadId] = useState<string | null>(null);
  const [slidingForward, setSlidingForward] = useState(false);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const columnOpenRef = useRef(false);
  const columnFillsRef = useRef(false);
  const crossRoomForkRef = useRef(Boolean(crossRoomFork));
  crossRoomForkRef.current = Boolean(crossRoomFork);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const enterLiveRoomPeek = useCallback(
    (peekFocus?: LiveRoomPeekFocus): LiveThreadBackUnder | null => {
      const stage = pageRef.current;
      const under = areaRef.current;
      if (!columnFillsRef.current || crossRoomForkRef.current || !stage || !under) return null;
      const over = stage.querySelector<HTMLElement>(':scope > [data-testid="thread-column"]');
      if (!over) return null;

      const savedReturnPlace = threadReturnPlaceRef.current;
      const savedCompactScroll = compactRoomScrollStateRef.current.get(roomId);
      const hasSavedReturnPlace = savedReturnPlace?.roomId === roomId;
      const focusEventId =
        peekFocus && (!peekFocus.onlyIfUnsaved || (!savedCompactScroll && !hasSavedReturnPlace))
          ? peekFocus.eventId
          : undefined;

      stage.setAttribute(SWIPE_THREAD_STAGE, '');
      under.setAttribute(SWIPE_UNDER_THREAD, '');
      try {
        flushSync(() => setPeekingRoom({ focusEventId }));
      } catch (error) {
        stage.removeAttribute(SWIPE_THREAD_STAGE);
        under.removeAttribute(SWIPE_UNDER_THREAD);
        throw error;
      }

      return {
        stage,
        over,
        under,
        exit(committed) {
          stage.removeAttribute(SWIPE_THREAD_STAGE);
          under.removeAttribute(SWIPE_UNDER_THREAD);
          if (!mountedRef.current || !pageRef.current) return;
          if (!committed || columnFillsRef.current) {
            setPeekingRoom(null);
            threadReturnPlaceRef.current = savedReturnPlace;
            if (savedCompactScroll) {
              compactRoomScrollStateRef.current.set(roomId, savedCompactScroll);
            } else {
              compactRoomScrollStateRef.current.delete(roomId);
            }
            return;
          }
          setPeekingRoom(null);
        },
      };
    },
    [roomId]
  );

  const enterLiveForwardPeek = useCallback((targetThreadId: string): LiveThreadBackUnder | null => {
    const stage = pageRef.current;
    const under = areaRef.current;
    if (
      !phoneRef.current ||
      columnOpenRef.current ||
      crossRoomForkRef.current ||
      !stage ||
      !under
    ) {
      return null;
    }

    stage.setAttribute(SWIPE_THREAD_STAGE, '');
    under.setAttribute(SWIPE_UNDER_THREAD, '');
    try {
      flushSync(() => setPeekingForwardThreadId(targetThreadId));
    } catch (error) {
      stage.removeAttribute(SWIPE_THREAD_STAGE);
      under.removeAttribute(SWIPE_UNDER_THREAD);
      throw error;
    }

    const over = stage.querySelector<HTMLElement>(':scope > [data-testid="thread-column"]');
    if (!over) {
      stage.removeAttribute(SWIPE_THREAD_STAGE);
      under.removeAttribute(SWIPE_UNDER_THREAD);
      if (mountedRef.current) setPeekingForwardThreadId(null);
      return null;
    }

    return {
      stage,
      over,
      under,
      exit() {
        stage.removeAttribute(SWIPE_THREAD_STAGE);
        under.removeAttribute(SWIPE_UNDER_THREAD);
        if (mountedRef.current) setPeekingForwardThreadId(null);
      },
    };
  }, []);

  const threadState = useRoomViewThreadState({
    room,
    threadId,
    eventId,
    hasMindroomAgents,
    enterLiveForwardPeek,
    enterLiveRoomPeek,
  });
  const { effectiveThreadId: openThreadId, viewMode } = threadState;
  const handleExitCrossRoomFork = useCallback(() => {
    onExitCrossRoomFork?.();
  }, [onExitCrossRoomFork]);
  const columnOpen = !!openThreadId || !!crossRoomFork;
  const { handleThreadLoadError } = threadState;
  const threadLoadFailed = useCallback(
    (failedThreadId: string) => {
      onThreadLoadError?.(failedThreadId);
      handleThreadLoadError(failedThreadId);
    },
    [handleThreadLoadError, onThreadLoadError]
  );
  const threadLayout = useThreadLayout(pageRef);
  // Every open thread (or cross-room fork draft) shows in the column: beside the room's messages
  // while the person chose that (or a second thread shows) and the page has room, else filling
  // the page, over the room's conversation, which goes.
  columnOpenRef.current = columnOpen;
  const columnFills =
    columnOpen && ((threadLayout.layout === 'full' && !besideWhileSecond) || !threadLayout.roomy);
  columnFillsRef.current = columnFills;

  // Detect same-room forward push (Room -> Thread) synchronously during render so
  // ConversationLayout stays uncollapsed as the live under-layer during the 280 ms slide.
  const [prevRoomColumn, setPrevRoomColumn] = useState({ roomId, columnFills });
  if (prevRoomColumn.roomId !== roomId || prevRoomColumn.columnFills !== columnFills) {
    const sameRoom = prevRoomColumn.roomId === roomId;
    const entering = sameRoom && !prevRoomColumn.columnFills && columnFills;
    setPrevRoomColumn({ roomId, columnFills });
    if (
      entering &&
      phone &&
      !crossRoomFork &&
      peekingForwardThreadId === null &&
      !spaceUnderLayer?.isSpaceSlideOwningThread() &&
      canPlayLiveSlide()
    ) {
      setSlidingForward(true);
    } else if (!columnFills && slidingForward) {
      setSlidingForward(false);
    }
  } else if (!phone && slidingForward) {
    setSlidingForward(false);
  }

  const peekingForwardOnly = peekingForwardThreadId !== null && !columnOpen;
  const renderedThreadId = openThreadId ?? peekingForwardThreadId ?? undefined;
  const renderColumn = columnOpen || peekingForwardThreadId !== null;
  const columnFillsOrPeeks = columnFills || peekingForwardOnly;
  const peekingOnly = columnFills && (peekingRoom !== null || slidingForward);
  const peekFocusEventId =
    columnFills && peekingRoom !== null ? peekingRoom.focusEventId : undefined;

  useLayoutEffect(() => {
    if (!columnFills && peekingRoom !== null) {
      completeLiveSlideHandoff();
    } else if (columnFills && peekingForwardThreadId !== null) {
      completeLiveSlideHandoff();
    }
  }, [columnFills, peekingForwardThreadId, peekingRoom]);

  useEffect(() => {
    if (!columnFills) setPeekingRoom(null);
  }, [columnFills]);

  useLayoutEffect(() => {
    if (!phone || !slidingForward) return undefined;
    const stage = pageRef.current;
    const under = areaRef.current;
    const over = stage?.querySelector<HTMLElement>(':scope > [data-testid="thread-column"]');
    if (!stage || !under || !over) {
      setSlidingForward(false);
      return undefined;
    }

    stage.setAttribute(SWIPE_THREAD_STAGE, '');
    under.setAttribute(SWIPE_UNDER_THREAD, '');
    const slide = playLiveSlide({
      direction: 'forward',
      stage,
      over,
      under,
      exit() {
        stage.removeAttribute(SWIPE_THREAD_STAGE);
        under.removeAttribute(SWIPE_UNDER_THREAD);
        if (mountedRef.current) setSlidingForward(false);
      },
    });
    return () => {
      slide.skip();
    };
  }, [phone, slidingForward]);
  // The unsent root deleted while its thread showed (onColumnGone).
  const deletedRoot = useRef<string>(undefined);
  useLocalEchoRoot(room, openThreadId, () => {
    deletedRoot.current = openThreadId;
    threadState.handleThreadRootDeleted();
  });
  // An upgraded room takes no more messages; its notice leads to the replacement.
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  const composerShown = canMessage && !tombstone;
  // Under a plugin's cover, behind a side panel or under the thread column filling the page, the
  // composer takes no keys.
  const hidden = useAtomValue(conversationHiddenAtom);
  // A side panel in the page's place hides the thread column too; a plugin's cover leaves it.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  // Under the column that fills the page, or with focus inside the beside thread column,
  // typing and Escape go to the column's composer instead.
  const focusColumn = useRef<() => void>(undefined);
  const focusComposer = useCallback(
    (evt: KeyboardEvent): boolean => {
      const inColumn =
        isThreadColumnKey(evt) ||
        (!!columnRef.current &&
          columnRef.current.contains(columnRef.current.ownerDocument.activeElement));
      if (columnFills || inColumn) {
        if (behindPanel || !focusColumn.current) return false;
        focusColumn.current();
        return true;
      }
      if (hidden) return false;
      ReactEditor.focus(editor);
      return true;
    },
    [behindPanel, columnFills, editor, hidden]
  );
  const focusScheduleComposer = useCallback(
    (targetThreadId?: string) => {
      if (targetThreadId) focusColumn.current?.();
      else ReactEditor.focus(editor);
    },
    [editor]
  );
  useTypeToCompose(focusComposer, composerShown && !behindPanel);

  // The open room (and thread) keeps its history downloads; leaving the room ends them.
  const focusedThreadId = isConfirmedMatrixEventId(openThreadId) ? openThreadId : undefined;
  useEffect(() => {
    engine.noteRoomFocused(roomId, focusedThreadId);
  }, [engine, roomId, focusedThreadId]);
  useEffect(() => () => engine.clearRoomFocus(roomId), [engine, roomId]);

  const focusConversation = useCallback(() => {
    areaRef.current
      ?.querySelector<HTMLElement>('[data-room-footer="true"] [contenteditable="true"]')
      ?.focus();
  }, []);
  // Before the effect below that sends the focus of a closed thread column to the composer: the
  // card of a thread the keys left takes it first.
  const unlessCardTakesFocus = useThreadKeys({
    roomId,
    areaRef,
    openThreadId: openThreadId ?? crossRoomFork?.threadId,
    viewMode,
    onOpenThread: threadState.handleOpenThread,
    onExitThread: crossRoomFork ? handleExitCrossRoomFork : threadState.handleExitThread,
    onFocusComposer: focusConversation,
    onFocusThread: () => focusColumn.current?.(),
  });

  // Beside its thread, the page shows the room's messages too, which its address does not name:
  // notifications count the room as on screen, as they do while the page shows only the room.
  useShownConversationView(columnOpen && !hidden, ROOM_MESSAGES_VIEW, roomId);
  // A reply drafted under an unsent root that is deleted goes to the room's composer, as the page's
  // own composer takes it (useUnconfirmedRootSends); the column's composer has saved it as it went.
  const store = useStore();
  const onColumnGone = useCallback(
    (columnThread: string) => {
      if (deletedRoot.current !== columnThread) return;
      moveMessageDraft(store, myUserId, roomId, columnThread);
    },
    [myUserId, roomId, store]
  );
  // The column filling the page hides the room's messages and their composer under it.
  useInert(areaRef, columnFills);
  useInert(columnRef, peekingForwardOnly);
  const setUnderThread = useSetAtom(conversationUnderThreadAtom);
  useLayoutEffect(() => {
    if (!columnFills) return undefined;
    setUnderThread(true);
    // Focus left there goes, as behind a side panel (Room.tsx): a browser need not move it off an
    // element that turns inert, and keys would reach it.
    const area = areaRef.current;
    const focused = area?.ownerDocument.activeElement;
    if (focused && area?.contains(focused)) (focused as HTMLElement).blur();
    return () => setUnderThread(false);
  }, [columnFills, setUnderThread]);
  // A Compact send whose root opens its thread: the focus, in the room's composer as it went, goes
  // on in the thread's composer, also where the column fills the page and the room's goes.
  const focusOpenedThread = useRef(false);
  const onRoomMessageSent = (eventId: string) => {
    const opened = threadState.handleRoomMessageSent(eventId);
    const focused = areaRef.current?.ownerDocument.activeElement;
    focusOpenedThread.current = opened && !!focused && !!areaRef.current?.contains(focused);
    return opened;
  };
  useEffect(() => {
    focusOpenedThread.current = false;
  }, [openThreadId]);
  // Show beside and Show in full change only the column's width: the thread and its composer stay.
  const showBeside = () => threadLayout.setLayout('beside');
  const showFull = () => threadLayout.setLayout('full');
  // Focus left in a thread column that closed goes to the room's composer; not on a phone, where
  // that would raise the keyboard over the room's messages.
  const hadColumn = useRef(false);
  useEffect(() => {
    const closed = hadColumn.current && !columnOpen;
    hadColumn.current = columnOpen;
    if (!closed || phone) return;
    // Not before the card of a thread the keys left had its pass to show: the focus moves once.
    unlessCardTakesFocus(() => {
      const doc = areaRef.current?.ownerDocument;
      if (doc && (!doc.activeElement || doc.activeElement === doc.body)) focusConversation();
    });
  }, [columnOpen, focusConversation, phone, unlessCardTakesFocus]);

  const onShowBeside = columnFills && threadLayout.roomy ? showBeside : undefined;
  const onShowFull = columnFills || besideWhileSecond ? undefined : showFull;
  const isSameRoomForkDraft = !crossRoomFork && Boolean(openThreadId && isEventId(forkAt));
  // The open thread's banner (or read-only draft banner for same-room and cross-room fork drafts).
  const threadBanner =
    crossRoomFork || isSameRoomForkDraft ? (
      <CrossRoomForkDraftBanner
        sourceRoom={crossRoomFork ? crossRoomFork.sourceRoom : room}
        targetRoom={room}
        canCompose={composerShown}
        onBack={crossRoomFork ? handleExitCrossRoomFork : threadState.handleExitThread}
        onShowBeside={onShowBeside}
        onShowFull={onShowFull}
      />
    ) : (
      renderedThreadId && (
        <ThreadContextBanner
          room={room}
          threadId={renderedThreadId}
          summaryInfo={
            peekingForwardOnly
              ? threadState.summaryMap.get(renderedThreadId)
              : threadState.threadSummaryInfo
          }
          onExitThread={peekingForwardOnly ? NOOP : threadState.handleExitThread}
          onShowBeside={peekingForwardOnly ? undefined : onShowBeside}
          onShowFull={peekingForwardOnly ? undefined : onShowFull}
        />
      )
    );
  const timelineProps: RoomTimelineProps = {
    room,
    // The event the address names is the thread's, unless it asks for it in the room (or a
    // live-peek swipe is previewing a direct-exit focus target).
    eventId: peekFocusEventId ?? (openThreadId && !focusEventInRoom ? undefined : eventId),
    focusEventInRoom: peekFocusEventId ? true : focusEventInRoom,
    entryKey: peekFocusEventId ? undefined : entryKey,
    entryPushed: peekFocusEventId ? false : entryPushed,
    entryReturned: peekFocusEventId ? false : entryReturned,
    hasMindroomAgents,
    summaryMap: threadState.summaryMap,
    onStoreThreadSummary: threadState.storeThreadSummary,
    threadFilterState: threadState.threadFilterState,
    threadSortFreezeState: threadState.threadSortFreezeState,
    setThreadSortFreezeState: threadState.setThreadSortFreezeState,
    onSortDirectionChange: threadState.handleSortDirectionChange,
    onToggleThreadSortFreeze: threadState.handleToggleThreadSortFreeze,
    onToggleUnresolvedOnly: threadState.handleToggleUnresolvedOnly,
    onToggleForMe: threadState.handleToggleForMe,
    onTogglePerson: threadState.handleTogglePerson,
    onClearPeople: threadState.handleClearPeople,
    onReset: threadState.handleReset,
    onAddTag: threadState.handleAddTag,
    onRemoveTag: threadState.handleRemoveTag,
    onClearTags: threadState.handleClearTags,
    onSelectTab: threadState.handleSelectTab,
    onShowSnoozed: threadState.handleShowSnoozed,
    onSearchQueryChange: threadState.handleSearchQueryChange,
    threadSections: threadState.threadSections,
    onToggleThreadSections: threadState.handleToggleThreadSections,
    viewMode,
    compactRoomScrollStateRef,
    threadReturnPlaceRef,
    editor,
    onThreadLoadError,
  };

  return (
    <Page ref={pageRef} style={renderColumn ? PAGE_ROW_STYLE : PAGE_STYLE}>
      <ConversationLayout
        room={room}
        areaRef={areaRef}
        // The plugins' slot shows under the header people see: the column's as it fills.
        header={(headerRef) => (
          <>
            <RoomViewHeader
              hasMindroomAgents={hasMindroomAgents}
              openThreadId={peekingOnly ? undefined : openThreadId}
              passive={peekingOnly}
              threadFilterState={threadState.threadFilterState}
              onFocusComposer={focusScheduleComposer}
              canEditSchedule={composerShown && !hidden}
              {...headerProps}
            />
            {!peekingOnly && <RoomHeaderSlot room={room} headerRef={headerRef} />}
          </>
        )}
        timeline={<RoomTimeline {...timelineProps} />}
        focusConversation={focusConversation}
        canCancelJobs={canCancelJobs}
        notice={<ComposerNotice room={room} tombstone={tombstone} canMessage={canMessage} />}
        composer={
          composerShown && (
            <RoomInput
              room={room}
              roomId={roomId}
              threadingEnabled={viewMode !== 'classic'}
              editor={editor}
              fileDropContainerRef={areaRef}
              onRoomMessageSent={onRoomMessageSent}
            />
          )
        }
        collapsed={
          columnFills && peekingRoom === null && !slidingForward && peekingForwardThreadId === null
        }
        conversationRef={conversationRef}
      >
        <ConversationCover key={roomId} room={room} conversationRef={conversationRef} />
      </ConversationLayout>
      {renderColumn && (
        <ResizablePanel
          side="end"
          storageKey={THREAD_COLUMN_WIDTH_KEY}
          defaultWidth={THREAD_COLUMN_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
          fullWidth={columnFillsOrPeeks}
          resizeLabel={t('thread.resize')}
          // While a second thread keeps it beside the messages, filling the page would not take.
          onExpand={besideWhileSecond ? undefined : showFull}
          expandLabel={t('thread.showFull')}
          testId="thread-column"
          onKeyDown={noteThreadColumnKey}
        >
          <div ref={columnRef} style={COLUMN_STYLE}>
            {!crossRoomFork && !peekingForwardOnly && threadState.threadNotFound ? (
              // A thread that is not this room's, nor of any joined room the client knows. Filling
              // the page, the column has the room's header the room area hides.
              <>
                {columnFills && (
                  <RoomViewHeader
                    hasMindroomAgents={hasMindroomAgents}
                    threadId={openThreadId}
                    threadFilterState={threadState.threadFilterState}
                    canEditSchedule={false}
                    {...headerProps}
                  />
                )}
                <PageHeroSection>
                  <PageHero
                    icon={<Icon size="600" src={Icons.Thread} />}
                    title={t('thread.notFound')}
                  >
                    <Button
                      size="300"
                      radii="300"
                      variant="Secondary"
                      fill="Soft"
                      onClick={threadState.handleThreadRootDeleted}
                    >
                      <Text size="B300">{t('thread.back')}</Text>
                    </Button>
                  </PageHero>
                </PageHeroSection>
              </>
            ) : (
              <ThreadView
                room={room}
                sourceRoom={crossRoomFork?.sourceRoom}
                threadId={crossRoomFork ? crossRoomFork.threadId : renderedThreadId!}
                eventId={
                  crossRoomFork
                    ? crossRoomFork.forkAt
                    : peekingForwardOnly || focusEventInRoom
                      ? undefined
                      : eventId
                }
                forkAt={
                  crossRoomFork ? crossRoomFork.forkAt : peekingForwardOnly ? undefined : forkAt
                }
                onExitCrossRoomFork={crossRoomFork ? handleExitCrossRoomFork : undefined}
                header={threadBanner}
                // The banner's title follows the summaries the thread's own events bring.
                summaryMap={crossRoomFork ? undefined : timelineProps.summaryMap}
                onStoreThreadSummary={
                  crossRoomFork ? undefined : timelineProps.onStoreThreadSummary
                }
                // Filling the page, the column has the room's header the room area hides.
                roomHeader={
                  columnFillsOrPeeks
                    ? (headerRef) => (
                        <>
                          <RoomViewHeader
                            hasMindroomAgents={hasMindroomAgents}
                            threadId={renderedThreadId}
                            passive={peekingForwardOnly}
                            threadFilterState={threadState.threadFilterState}
                            onFocusComposer={focusScheduleComposer}
                            canEditSchedule={
                              composerShown &&
                              !isConfirmedMatrixEventId(forkAt) &&
                              !crossRoomFork &&
                              !behindPanel &&
                              !peekingForwardOnly
                            }
                            {...headerProps}
                          />
                          {!peekingForwardOnly && (
                            <RoomHeaderSlot room={room} headerRef={headerRef} />
                          )}
                        </>
                      )
                    : undefined
                }
                // Beside the messages, where typing goes to the room's composer, it takes the focus,
                // and from the room's composer whose send opened it. ThreadView reads it as the
                // thread opens, in the effects of the commit that opens it, before this view's reset.
                autoFocus={(!columnFills || focusOpenedThread.current) && !peekingForwardOnly}
                hidden={behindPanel || peekingForwardOnly}
                onThreadLoadError={
                  crossRoomFork || peekingForwardOnly ? undefined : threadLoadFailed
                }
                onUnmount={crossRoomFork || peekingForwardOnly ? undefined : onColumnGone}
                focusRef={peekingForwardOnly ? undefined : focusColumn}
                // Files dropped anywhere on the column, its header too, go to the thread's composer.
                fileDropContainerRef={columnRef}
              />
            )}
          </div>
        </ResizablePanel>
      )}
    </Page>
  );
}
