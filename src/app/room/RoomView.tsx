import React, {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from 'react';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
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
import { BackgroundJobsBar } from '../background-jobs/BackgroundJobsBar';
import { computerOwnsKeyboardEvent } from '../computer/computerFocus';
import { useSyncEngine } from '../event-store/engine/engineContext';
import { FailedSendActions } from '../messages/FailedSendActions';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import { ThreadApprovalQueue } from '../approvals/ThreadApprovalControls';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import type { ScrollAnchorMemory } from '../ui/scrollAnchorMemory';
import { RoomTimeline, type RoomTimelineProps } from '../timeline/RoomTimeline';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import { RoomHeaderSlot } from './RoomHeaderSlot';
import { ConversationCover } from './ConversationCover';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import * as overlay from '../ui/styles/RoomOverlay.css';
import * as css from './RoomView.css';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import { isConfirmedMatrixEventId, isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import { useShortcut } from '../shortcuts/useShortcut';

const EMPTY_SUMMARY_MAP = new Map<string, ThreadSummaryInfo>();
/** Stand-in for handlers the thread state mock or a minimal state leaves out. */
const ignore = () => undefined;

const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';

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
      ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'inset', composer, dock }) }));
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
const useTypeToCompose = (editor: ReturnType<typeof useEditor>, enabled: boolean) => {
  const handleKey = useCallback(
    (evt: KeyboardEvent) => {
      if (!enabled || evt.defaultPrevented || evt.ctrlKey || evt.metaKey || evt.altKey) return;
      if (!/^(Key[A-Z]|Digit\d)$/.test(evt.code ?? '')) return;
      // The agent's computer screen takes its own keystrokes.
      if (computerOwnsKeyboardEvent(evt) || editableActiveElement() || focusOwnsTyping()) return;
      ReactEditor.focus(editor as ReactEditor);
    },
    [editor, enabled]
  );
  useKeyDown(window, handleKey);
  useShortcut('focusComposer', () => {
    if (!enabled || focusOwnsTyping()) return false;
    ReactEditor.focus(editor as ReactEditor);
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
 * the thread keeps its pending uploads.
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
  const compactRoomScrollStateRef = useRef<ScrollAnchorMemory>(new Map());

  const myUserId = client.getSafeUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const canMessage = permissions.event('m.room.message', myUserId);
  // Cancelling a background job sends an event, so it takes that event's power level.
  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, myUserId);

  const threadState = useRoomViewThreadState({ room, threadId, eventId, hasMindroomAgents });
  const { effectiveThreadId, viewMode } = threadState;
  const localRoot = useLocalEchoRoot(
    room,
    effectiveThreadId,
    threadState.handleThreadRootDeleted ?? ignore
  );
  // An upgraded room takes no more messages; its notice leads to the replacement.
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  // A thread whose root the server has not confirmed keeps its composer: a reply sent there
  // waits for the root (`useUnconfirmedRootSends`).
  const composerShown = canMessage && !tombstone;
  const failedRoot =
    localRoot.pending && localRoot.event && isFailedLocalEchoEvent(localRoot.event)
      ? localRoot.event
      : undefined;
  // Under a plugin's cover the composer takes no keys.
  const covered = useAtomValue(conversationCoveredAtom);
  useTypeToCompose(editor, composerShown && !covered);
  useRoomOverlayInsets(areaRef, headerRef, footerRef, dockRef, effectiveThreadId);

  // The open room (and thread) keeps its history downloads; leaving the room ends them.
  const focusedThreadId = isConfirmedMatrixEventId(effectiveThreadId)
    ? effectiveThreadId
    : undefined;
  useEffect(() => {
    engine.noteRoomFocused(roomId, focusedThreadId);
  }, [engine, roomId, focusedThreadId]);
  useEffect(() => () => engine.clearRoomFocus(roomId), [engine, roomId]);

  const focusConversation = useCallback(() => {
    footerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  }, []);

  const threadHeader = effectiveThreadId ? (
    <ThreadContextBanner
      room={room}
      threadId={effectiveThreadId}
      summaryInfo={threadState.threadSummaryInfo}
      onExitThread={threadState.handleExitThread ?? ignore}
    />
  ) : undefined;
  const timelineProps: RoomTimelineProps = {
    room,
    eventId,
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
    <Page>
      <div ref={areaRef} className={css.RoomArea} style={AREA_STYLE}>
        <div
          ref={headerRef}
          className={classNames(
            overlay.Header,
            css.HeaderInShortArea,
            effectiveThreadId && overlay.HeaderInThread
          )}
        >
          <RoomViewHeader
            hasMindroomAgents={hasMindroomAgents}
            threadId={effectiveThreadId}
            threadFilterState={threadState.threadFilterState}
            {...headerProps}
          />
          <RoomHeaderSlot room={room} />
        </div>
        <div ref={conversationRef} style={CONVERSATION_STYLE}>
          <ThreadApprovalProvider
            room={room}
            // A message not yet on the server has no approvals, and no relations to ask for.
            threadId={focusedThreadId}
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
    </Page>
  );
}
