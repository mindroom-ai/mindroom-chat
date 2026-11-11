import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { useEditor } from '../editor/Editor';
import { Page } from '../ui/page/Page';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { editableActiveElement } from '../lib/dom';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';
import { RoomInput } from '../composer/RoomInput';
import {
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  voiceRecorderRoomAtom,
  moveMessageDraft,
} from '../composer/roomInputDrafts';
import { BackgroundJobsBar } from '../background-jobs/BackgroundJobsBar';
import { computerOwnsKeyboardEvent } from '../computer/computerFocus';
import { useSyncEngine } from '../event-store/engine/engineContext';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
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
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../ui/panels/ResizablePanel';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { SurfaceProvider } from '../ui/glass/SurfaceContext';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import {
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
  resolveCanonicalThreadRootId,
} from '../event-store/threads/threadRouteUtils';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import { useShortcut } from '../shortcuts/useShortcut';
import { ThreadView } from './ThreadView';
import { ComposerNotice, ConversationLayout } from './ConversationLayout';
import { useLocalEchoRoot } from './useLocalEchoRoot';
import { noteThreadColumnKey } from './useRoomEscapeReadReceipts';
import { storedThreadLayout, THREAD_COLUMN_WIDTH_KEY, useThreadLayout } from './threadLayout';

const EMPTY_SUMMARY_MAP = new Map<string, ThreadSummaryInfo>();
/** Stand-in for handlers the thread state mock or a minimal state leaves out. */
const ignore = () => undefined;

const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';
/** The thread column opens this wide, and may take what the messages beside it can spare. */
const THREAD_COLUMN_DEFAULT_WIDTH = 480;
const THREAD_COLUMN_MAX_WIDTH = 4096;
// The page's own style (Page), and with the thread column beside the room area.
const PAGE_STYLE: CSSProperties = { minHeight: 0, minWidth: 0 };
const PAGE_ROW_STYLE: CSSProperties = { ...PAGE_STYLE, flexDirection: 'row' };

// The column stacks the room's header, while it fills the page, over the thread.
const COLUMN_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
};
const COLUMN_HEADER_STYLE: CSSProperties = { position: 'relative', flexShrink: 0 };

/** Where a thread shows, chosen as it opens: in the column of its own, or in the messages' place. */
type ThreadPlace = { threadId: string; column: boolean };

export type RoomViewProps = Omit<RoomViewHeaderProps, 'threadId' | 'threadFilterState'> & {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** The route asks to show `eventId` in the room timeline rather than in its thread. */
  focusEventInRoom?: boolean;
  onThreadLoadError?: (threadId: string) => void;
};

// Dialogs, menus and lists keep their own typing (fields, type-ahead), and so does a region
// marked `data-keeps-typing`.
const OWNS_TYPING_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-keeps-typing]';
const focusOwnsTyping = (): boolean =>
  typeof document !== 'undefined' && !!document.activeElement?.closest?.(OWNS_TYPING_SELECTOR);

/**
 * Typing a letter or digit with nothing focused starts a message in the composer, and Escape
 * outside a field or menu goes back to it (the room's Escape handler reads its main timeline, or
 * the open thread, as well). Neither takes a key that a handler cancelled (`preventDefault`)
 * before it reached the window, nor a key pressed inside an element marked `data-keeps-typing`:
 * a region that reads keys without a text field (a game, a drawing surface) carries it.
 */
const useTypeToCompose = (focusComposer: () => void, enabled: boolean) => {
  const handleKey = useCallback(
    (evt: KeyboardEvent) => {
      if (!enabled || evt.defaultPrevented || evt.ctrlKey || evt.metaKey || evt.altKey) return;
      if (!/^(Key[A-Z]|Digit\d)$/.test(evt.code ?? '')) return;
      // The agent's computer screen takes its own keystrokes.
      if (computerOwnsKeyboardEvent(evt) || editableActiveElement() || focusOwnsTyping()) return;
      focusComposer();
    },
    [enabled, focusComposer]
  );
  useKeyDown(window, handleKey);
  useShortcut('focusComposer', () => {
    if (!enabled || focusOwnsTyping()) return false;
    focusComposer();
    return true;
  });
};

/**
 * The main area of a room: the timeline (Compact cards, the Full timeline, or the open thread
 * with its banner) under a floating header and footer, with approvals and background jobs
 * above the composer. The composer stays mounted when a thread opens, so a send that opened
 * the thread keeps its pending uploads. Where the person chose it and the page has room
 * (`useThreadLayout`), a thread opens in a column of its own beside the room's messages instead, a
 * conversation view (`ThreadView`) with its own composer, which fills the page when the person
 * asks for the thread in full or the page turns too narrow. A thread keeps its place while it stays
 * open, so it never moves between the two composers with a reply, files or a send under way.
 */
export function RoomView({
  room,
  eventId,
  threadId,
  focusEventInRoom,
  hasMindroomAgents,
  onThreadLoadError,
  ...headerProps
}: RoomViewProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const editor = useEditor();
  const engine = useSyncEngine();
  const { roomId } = room;
  const areaRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const columnHeaderRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const compactRoomScrollStateRef = useRef<ScrollAnchorMemory>(new Map());
  const threadReturnPlaceRef = useRef<RoomRowsPlace>();

  const myUserId = client.getSafeUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const canMessage = permissions.event('m.room.message', myUserId);
  // Cancelling a background job sends an event, so it takes that event's power level.
  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, myUserId);

  const threadState = useRoomViewThreadState({ room, threadId, eventId, hasMindroomAgents });
  const { effectiveThreadId: openThreadId, viewMode } = threadState;
  const threadLayout = useThreadLayout(pageRef);
  // A thread opens in the column while the person chose it and the page has room, and stays where
  // it opened; a root that gets its own ID is the same thread.
  const [place, setPlace] = useState<ThreadPlace>();
  const samePlace =
    !!place &&
    (place.threadId === openThreadId ||
      (isLocalEchoEventId(place.threadId) &&
        resolveCanonicalThreadRootId(room, place.threadId) === openThreadId));
  const inColumn =
    !!openThreadId &&
    (samePlace ? place.column : threadLayout.roomy && storedThreadLayout() === 'beside');
  // It takes its place once the page has measured itself, which it does before it paints.
  if (!openThreadId) {
    if (place) setPlace(undefined);
  } else if (threadLayout.measured && place?.threadId !== openThreadId) {
    setPlace({ threadId: openThreadId, column: inColumn });
  }
  const columnThreadId = inColumn ? openThreadId : undefined;
  const columnFills = !!columnThreadId && (threadLayout.layout === 'full' || !threadLayout.roomy);
  const effectiveThreadId = columnThreadId ? undefined : openThreadId;
  // The unsent root deleted while its thread showed in the column (onColumnGone).
  const deletedRoot = useRef<string>();
  const localRoot = useLocalEchoRoot(room, openThreadId, () => {
    deletedRoot.current = columnThreadId;
    (threadState.handleThreadRootDeleted ?? ignore)();
  });
  // An upgraded room takes no more messages; its notice leads to the replacement.
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  // A thread whose root the server has not confirmed keeps its composer: a reply sent there
  // waits for the root (`useUnconfirmedRootSends`).
  const composerShown = canMessage && !tombstone;
  const failedRoot =
    localRoot.pending && localRoot.event && isFailedLocalEchoEvent(localRoot.event)
      ? localRoot.event
      : undefined;
  // Under a plugin's cover, behind a side panel or under the thread column filling the page, the
  // composer takes no keys.
  const hidden = useAtomValue(conversationHiddenAtom);
  // A side panel in the page's place hides the thread column too; a plugin's cover leaves it.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  // Under the column that fills the page, typing goes to the column's composer instead.
  const focusColumn = useRef<() => void>();
  const focusComposer = useCallback(() => {
    if (!columnFills) ReactEditor.focus(editor as ReactEditor);
    else focusColumn.current?.();
  }, [columnFills, editor]);
  useTypeToCompose(focusComposer, composerShown && (columnFills ? !behindPanel : !hidden));

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

  // Beside its thread, the page shows the room's messages too, which its address does not name:
  // notifications count the room as on screen, as they do while the page shows only the room.
  useShownConversationView(!!columnThreadId && !hidden, ROOM_MESSAGES_VIEW, roomId);
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
  // A thread in the messages' place moves to the column only with nothing in its composer but text,
  // which the thread keeps: no reply, file or voice message goes from one composer to the other.
  const pageReply = useAtomValue(composerReplyDraftAtom(roomId, undefined));
  const pageFiles = useAtomValue(composerUploadItemsAtom(roomId, undefined)).length > 0;
  const pageRecording = useAtomValue(voiceRecorderRoomAtom) === roomId;
  const showBeside = () => {
    if (openThreadId) setPlace({ threadId: openThreadId, column: true });
    threadLayout.setLayout('beside');
  };
  // Focus left in a thread column that closed (or took the messages' place) goes to the composer.
  const hadColumn = useRef(false);
  useEffect(() => {
    const closed = hadColumn.current && !columnThreadId;
    hadColumn.current = !!columnThreadId;
    if (closed && (!document.activeElement || document.activeElement === document.body)) {
      focusConversation();
    }
  }, [columnThreadId, focusConversation]);

  const showFull = () => threadLayout.setLayout('full');
  // The open thread's banner, in the messages' place or in the column, with its way to the other.
  const threadBanner = openThreadId && (
    <ThreadContextBanner
      room={room}
      threadId={openThreadId}
      summaryInfo={threadState.threadSummaryInfo}
      onExitThread={threadState.handleExitThread ?? ignore}
      onShowBeside={!columnThreadId && threadLayout.roomy ? showBeside : undefined}
      showBesideBlocked={!!pageReply || pageFiles || pageRecording}
      onShowFull={columnThreadId && !columnFills ? showFull : undefined}
      onRestore={columnFills && threadLayout.roomy ? showBeside : undefined}
    />
  );
  const threadHeader = columnThreadId ? undefined : threadBanner;
  const timelineProps: RoomTimelineProps = {
    room,
    // The event the address names is the thread's, unless it asks for it in the room.
    eventId: columnThreadId && !focusEventInRoom ? undefined : eventId,
    threadId: effectiveThreadId,
    focusEventInRoom,
    hasMindroomAgents,
    threadHeader,
    summaryMap: threadState.summaryMap ?? EMPTY_SUMMARY_MAP,
    onStoreThreadSummary: threadState.storeThreadSummary ?? ignore,
    threadFilterState: threadState.threadFilterState,
    threadSortFreezeState: threadState.threadSortFreezeState ?? null,
    setThreadSortFreezeState: threadState.setThreadSortFreezeState,
    onToggle: threadState.handleToggle,
    onSortDirectionChange: threadState.handleSortDirectionChange,
    onToggleThreadSortFreeze: threadState.handleToggleThreadSortFreeze,
    onToggleUnresolvedOnly: threadState.handleToggleUnresolvedOnly,
    onTogglePerson: threadState.handleTogglePerson,
    onClearPeople: threadState.handleClearPeople,
    onReset: threadState.handleReset,
    onAddTag: threadState.handleAddTag,
    onRemoveTag: threadState.handleRemoveTag,
    onClearTags: threadState.handleClearTags,
    onApplyPreset: threadState.handleApplyPreset,
    onSearchQueryChange: threadState.handleSearchQueryChange,
    viewMode,
    onViewModeChange: threadState.handleViewModeChange,
    compactRoomScrollStateRef,
    threadReturnPlaceRef,
    editor,
    onThreadLoadError,
  };

  return (
    <Page ref={pageRef} style={columnThreadId ? PAGE_ROW_STYLE : PAGE_STYLE}>
      <ConversationLayout
        room={room}
        threadId={effectiveThreadId}
        areaRef={areaRef}
        // The plugins' slot shows under the header people see: the column's as it fills.
        header={(headerRef) => (
          <>
            <RoomViewHeader
              hasMindroomAgents={hasMindroomAgents}
              threadId={effectiveThreadId}
              openThreadId={openThreadId}
              threadFilterState={threadState.threadFilterState}
              {...headerProps}
            />
            <RoomHeaderSlot room={room} headerRef={headerRef} />
          </>
        )}
        timeline={<RoomTimeline {...timelineProps} />}
        focusConversation={focusConversation}
        canCancelJobs={canCancelJobs}
        notice={
          <ComposerNotice
            room={room}
            failedRoot={failedRoot}
            tombstone={tombstone}
            canMessage={canMessage}
          />
        }
        composer={
          composerShown && (
            <RoomInput
              room={room}
              roomId={roomId}
              threadId={effectiveThreadId}
              threadingEnabled={viewMode !== 'classic'}
              editor={editor}
              fileDropContainerRef={areaRef}
              onRoomMessageSent={threadState.handleRoomMessageSent}
            />
          )
        }
        collapsed={columnFills}
        conversationRef={conversationRef}
      >
        <ConversationCover key={roomId} room={room} conversationRef={conversationRef} />
      </ConversationLayout>
      {columnThreadId && (
        <ResizablePanel
          side="end"
          storageKey={THREAD_COLUMN_WIDTH_KEY}
          defaultWidth={THREAD_COLUMN_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={THREAD_COLUMN_MAX_WIDTH}
          fullWidth={columnFills}
          resizeLabel={t('thread.resize')}
          onExpand={showFull}
          expandLabel={t('thread.showFull')}
          testId="thread-column"
          onKeyDown={noteThreadColumnKey}
        >
          <div ref={columnRef} style={COLUMN_STYLE}>
            {/* Filling the page, the column has the room's header the room area hides. */}
            {columnFills && (
              <div
                ref={columnHeaderRef}
                data-glass-flat="true"
                className={classNames(overlay.Header, overlay.HeaderInThread)}
                style={COLUMN_HEADER_STYLE}
              >
                <SurfaceProvider value>
                  <RoomViewHeader
                    hasMindroomAgents={hasMindroomAgents}
                    threadId={columnThreadId}
                    threadFilterState={threadState.threadFilterState}
                    {...headerProps}
                  />
                  <RoomHeaderSlot room={room} headerRef={columnHeaderRef} />
                </SurfaceProvider>
              </div>
            )}
            <ThreadView
              room={room}
              threadId={columnThreadId}
              eventId={focusEventInRoom ? undefined : eventId}
              header={threadBanner}
              autoFocus
              hidden={behindPanel}
              onThreadLoadError={onThreadLoadError}
              onUnmount={onColumnGone}
              focusRef={focusColumn}
              // Files dropped anywhere on the column, its header too, go to the thread's composer.
              fileDropContainerRef={columnRef}
            />
            {/* Under the thread, where its list of jobs opens upward over the timeline. */}
            {columnFills && (
              <BackgroundJobsBar room={room} threadId={columnThreadId} canCancel={canCancelJobs} />
            )}
          </div>
        </ResizablePanel>
      )}
    </Page>
  );
}
