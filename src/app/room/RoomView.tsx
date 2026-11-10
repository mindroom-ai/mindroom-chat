import React, {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { EventStatus, RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { Box, Text, color, config } from 'folds';
import { useEditor } from '../editor/Editor';
import { Page } from '../ui/page/Page';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { editableActiveElement } from '../lib/dom';
import { RoomViewFollowing } from '../timeline/RoomViewFollowing';
import { RoomViewTyping } from '../timeline/typing/RoomViewTyping';
import { RoomTombstone } from './RoomTombstone';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';
import { RoomInput } from '../composer/RoomInput';
import {
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  voiceRecorderRoomAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { BackgroundJobsBar } from '../background-jobs/BackgroundJobsBar';
import { computerOwnsKeyboardEvent } from '../computer/computerFocus';
import { useSyncEngine } from '../event-store/engine/engineContext';
import { FailedSendActions } from '../messages/FailedSendActions';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import { ThreadApprovalQueue } from '../approvals/ThreadApprovalControls';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
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
import * as css from './RoomView.css';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import {
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
  resolveCanonicalThreadRootId,
} from '../event-store/threads/threadRouteUtils';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import { useShortcut } from '../shortcuts/useShortcut';
import { ThreadView } from './ThreadView';
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

/** Timeline props this view passes beyond the timeline's own contract, for the parts that use them. */
// The room area is the positioning box of the floating header, dock and footer.
const AREA_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
};
// Under the thread column that fills the page, the room area takes no room in the row but stays as
// it was laid out, its scroll position too (as behind a side panel in Room.tsx).
const AREA_UNDER_THREAD_STYLE: CSSProperties = {
  ...AREA_STYLE,
  flex: '0 0 0',
  contentVisibility: 'hidden',
};
const TIMELINE_STYLE: CSSProperties = { minHeight: 0, minWidth: 0 };
// Groups what a plugin's cover hides, without a box of its own in the room area's layout.
const CONVERSATION_STYLE: CSSProperties = { display: 'contents' };
// Background jobs and approvals float just above the composer.
const DOCK_STYLE: CSSProperties = {
  position: 'absolute',
  insetInline: 0,
  bottom: 'var(--room-composer-height, 0px)',
  zIndex: 5,
  pointerEvents: 'none',
};
const DOCK_CONTENT_STYLE: CSSProperties = { pointerEvents: 'auto' };
// Where the composer would be: why it is not there; or above it, what to do about the unsent root.
const NOTICE_GAP = config.space.S400;
const NOTICE_STYLE: CSSProperties = {
  background: color.SurfaceVariant.Container,
  margin: `0 ${NOTICE_GAP} ${NOTICE_GAP}`,
  color: color.SurfaceVariant.OnContainer,
  padding: `${config.space.S300} ${NOTICE_GAP}`,
  borderRadius: config.radii.R400,
};

/**
 * Keeps the heights of the floating header and footer on the room area, where the scroll areas
 * read them (`--room-header-height`, `--room-footer-height`) to pad their content clear of both.
 * The dock remounts with each thread, so it is measured again whenever the thread changes.
 */
const useRoomOverlayInsets = (
  areaRef: RefObject<HTMLElement>,
  headerRef: RefObject<HTMLElement>,
  footerRef: RefObject<HTMLElement>,
  dockRef: RefObject<HTMLElement>,
  threadId: string | undefined
) => {
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const header = headerRef.current?.offsetHeight ?? 0;
      const composer = footerRef.current?.offsetHeight ?? 0;
      const dock = dockRef.current?.offsetHeight ?? 0;
      area.style.setProperty('--room-header-height', `${header}px`);
      area.style.setProperty('--room-composer-height', `${composer}px`);
      area.style.setProperty('--room-footer-height', `${composer + dock}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [headerRef, footerRef, dockRef].forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });
    return () => observer.disconnect();
  }, [areaRef, dockRef, footerRef, headerRef, threadId]);
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
 * The open thread's root while it is still a local echo: its event, when the room holds it.
 * Re-renders as the echo's send state changes, and reports a root that was deleted unsent.
 */
const useLocalEchoRoot = (room: Room, threadId: string | undefined, onDeleted: () => void) => {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const pending = isLocalEchoEventId(threadId);
  const latestOnDeleted = useRef(onDeleted);
  latestOnDeleted.current = onDeleted;

  useEffect(() => {
    if (!pending) return undefined;
    const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, _room, oldId) => {
      if (oldId !== threadId && event.getId() !== threadId) return;
      if (event.status === EventStatus.CANCELLED) latestOnDeleted.current();
      else refresh();
    };
    room.on(RoomEvent.LocalEchoUpdated, onEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
    };
  }, [pending, room, threadId]);

  if (!pending || !threadId) return { pending: false as const };
  return { pending: true as const, event: room.findEventById(threadId) ?? undefined };
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
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
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
  useTypeToCompose(focusComposer, columnFills ? !behindPanel : composerShown && !hidden);
  useRoomOverlayInsets(areaRef, headerRef, footerRef, dockRef, effectiveThreadId);

  // The open room (and thread) keeps its history downloads; leaving the room ends them.
  const focusedThreadId = isConfirmedMatrixEventId(openThreadId) ? openThreadId : undefined;
  useEffect(() => {
    engine.noteRoomFocused(roomId, focusedThreadId);
  }, [engine, roomId, focusedThreadId]);
  useEffect(() => () => engine.clearRoomFocus(roomId), [engine, roomId]);

  const focusConversation = useCallback(() => {
    footerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
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
      const from = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(myUserId, roomId, columnThread));
      const to = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(myUserId, roomId));
      if (store.get(to).length === 0) store.set(to, store.get(from));
      store.set(from, []);
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

  let composerNotice: React.ReactNode;
  if (failedRoot) {
    composerNotice = <FailedSendActions room={room} event={failedRoot} style={NOTICE_STYLE} />;
  } else if (tombstone) {
    composerNotice = <RoomTombstone tombstone={tombstone} style={NOTICE_STYLE} />;
  } else if (!canMessage) {
    composerNotice = (
      <Box justifyContent="Center" style={NOTICE_STYLE}>
        <Text size="T300" priority="300">
          {t('mindroomUi.threads.mindroomRoomView.youDoNotHavePermissionToPostInThisRoom')}
        </Text>
      </Box>
    );
  }

  return (
    <Page ref={pageRef} style={columnThreadId ? PAGE_ROW_STYLE : PAGE_STYLE}>
      <div
        ref={areaRef}
        className={css.RoomArea}
        style={columnFills ? AREA_UNDER_THREAD_STYLE : AREA_STYLE}
      >
        {/* The element draws the header's surface; the row inside shows it and paints none. */}
        <div
          ref={headerRef}
          data-glass-flat="true"
          className={classNames(
            overlay.Header,
            css.HeaderInShortArea,
            effectiveThreadId && overlay.HeaderInThread
          )}
        >
          <SurfaceProvider value>
            <RoomViewHeader
              hasMindroomAgents={hasMindroomAgents}
              threadId={effectiveThreadId}
              openThreadId={openThreadId}
              threadFilterState={threadState.threadFilterState}
              {...headerProps}
            />
            <RoomHeaderSlot room={room} headerRef={headerRef} />
          </SurfaceProvider>
        </div>
        <div ref={conversationRef} style={CONVERSATION_STYLE}>
          <ThreadApprovalProvider
            room={room}
            // A message not yet on the server has no approvals, and no relations to ask for.
            threadId={columnThreadId ? undefined : focusedThreadId}
            focusConversation={focusConversation}
          >
            <Box grow="Yes" direction="Column" style={TIMELINE_STYLE}>
              <RoomTimeline {...timelineProps} />
            </Box>
            <div ref={dockRef} style={DOCK_STYLE}>
              <div style={DOCK_CONTENT_STYLE}>
                <BackgroundJobsBar
                  room={room}
                  threadId={effectiveThreadId ?? null}
                  canCancel={canCancelJobs}
                />
                {effectiveThreadId && <ThreadApprovalQueue />}
              </div>
            </div>
          </ThreadApprovalProvider>
          {/* Outside the approval provider: opening a thread must not remount the composer. */}
          <div ref={footerRef} className={overlay.Footer} data-room-footer="true">
            <RoomViewTyping room={room} threadId={effectiveThreadId} />
            {composerNotice}
            {composerShown && (
              <RoomInput
                room={room}
                roomId={roomId}
                threadId={effectiveThreadId}
                threadingEnabled={viewMode !== 'classic'}
                editor={editor}
                fileDropContainerRef={areaRef}
                onRoomMessageSent={threadState.handleRoomMessageSent}
              />
            )}
            <RoomViewFollowing room={room} threadId={effectiveThreadId} />
          </div>
        </div>
        <ConversationCover key={roomId} room={room} conversationRef={conversationRef} />
      </div>
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
        >
          <div style={COLUMN_STYLE} data-thread-column>
            {/* Filling the page, the column has the room's header the room area hides. */}
            {columnFills && (
              <div
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
