import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
import { moveMessageDraft, openVoiceRecorderAtom } from '../composer/roomInputDrafts';
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
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../ui/panels/ResizablePanel';
import { ThreadContextBanner } from '../threads/ThreadContextBanner';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import { useShortcut } from '../shortcuts/useShortcut';
import { ThreadView } from './ThreadView';
import { ComposerNotice, ConversationLayout } from './ConversationLayout';
import { useLocalEchoRoot } from './useLocalEchoRoot';
import { noteThreadColumnKey } from './useRoomEscapeReadReceipts';
import { useThreadKeys } from './useThreadKeys';
import { focusOwnsTyping, isPasteKey, isTypingKey } from './typeToCompose';
import { THREAD_COLUMN_WIDTH_KEY, useThreadLayout } from './threadLayout';

const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';
/** The thread column opens this wide, and may take what the messages beside it can spare. */
const THREAD_COLUMN_DEFAULT_WIDTH = 480;
const THREAD_COLUMN_MAX_WIDTH = 4096;
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

export type RoomViewProps = Omit<RoomViewHeaderProps, 'threadId' | 'threadFilterState'> & {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** The open thread is a fork draft from this message of it (`ThreadView`). */
  forkAt?: string;
  /** The route asks to show `eventId` in the room timeline rather than in its thread. */
  focusEventInRoom?: boolean;
  /** The router's key of the history entry whose address this is. */
  entryKey?: string;
  /** Whether the router pushed that entry (a link followed), not replaced or returned to it. */
  entryPushed?: boolean;
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
const useTypeToCompose = (focusComposer: () => void, enabled: boolean) => {
  const handleKey = useCallback(
    (evt: KeyboardEvent) => {
      if (!enabled || evt.defaultPrevented) return;
      if (!isTypingKey(evt) && !isPasteKey(evt)) return;
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
  focusEventInRoom,
  entryKey,
  entryPushed,
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
  const threadReturnPlaceRef = useRef<RoomRowsPlace>();

  const myUserId = client.getSafeUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const canMessage = permissions.event('m.room.message', myUserId);
  // Cancelling a background job sends an event, so it takes that event's power level.
  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, myUserId);

  const threadState = useRoomViewThreadState({ room, threadId, eventId, hasMindroomAgents });
  const { effectiveThreadId: openThreadId, viewMode } = threadState;
  const { handleThreadLoadError } = threadState;
  const threadLoadFailed = useCallback(
    (failedThreadId: string) => {
      onThreadLoadError?.(failedThreadId);
      handleThreadLoadError(failedThreadId);
    },
    [handleThreadLoadError, onThreadLoadError]
  );
  const threadLayout = useThreadLayout(pageRef);
  // Every open thread shows in the column: beside the room's messages while the person chose that
  // (or a second thread shows) and the page has room, else filling the page, over the room's
  // conversation, which goes. A second thread changes no stored layout: closed, it holds again.
  // A voice message recorded as the second thread closes keeps the thread beside until it is sent
  // or discarded: filling the page would take the messages' composer, and its recording, away.
  const recording = useAtomValue(openVoiceRecorderAtom) !== undefined;
  const [heldBeside, setHeldBeside] = useState(false);
  const besideForSecond = besideWhileSecond || (heldBeside && recording);
  if (heldBeside !== besideForSecond) setHeldBeside(besideForSecond);
  const columnFills =
    !!openThreadId && ((threadLayout.layout === 'full' && !besideForSecond) || !threadLayout.roomy);
  // The unsent root deleted while its thread showed (onColumnGone).
  const deletedRoot = useRef<string>();
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
  // Before the effect below that sends the focus of a closed thread column to the composer: the
  // card of a thread the keys left takes it first.
  const unlessCardTakesFocus = useThreadKeys({
    roomId,
    areaRef,
    openThreadId,
    viewMode,
    onOpenThread: threadState.handleOpenThread,
    onExitThread: threadState.handleExitThread,
    onFocusComposer: focusConversation,
    onFocusThread: () => focusColumn.current?.(),
  });

  // Beside its thread, the page shows the room's messages too, which its address does not name:
  // notifications count the room as on screen, as they do while the page shows only the room.
  useShownConversationView(!!openThreadId && !hidden, ROOM_MESSAGES_VIEW, roomId);
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
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const hadColumn = useRef(false);
  useEffect(() => {
    const closed = hadColumn.current && !openThreadId;
    hadColumn.current = !!openThreadId;
    if (!closed || phone) return;
    // Not before the card of a thread the keys left had its pass to show: the focus moves once.
    unlessCardTakesFocus(() => {
      const doc = areaRef.current?.ownerDocument;
      if (doc && (!doc.activeElement || doc.activeElement === doc.body)) focusConversation();
    });
  }, [openThreadId, focusConversation, phone, unlessCardTakesFocus]);

  // The open thread's banner, with the way to fill the page or to go beside the messages. While a
  // second thread keeps it beside them, filling the page would not take, so it offers neither.
  const threadBanner = openThreadId && (
    <ThreadContextBanner
      room={room}
      threadId={openThreadId}
      summaryInfo={threadState.threadSummaryInfo}
      onExitThread={threadState.handleExitThread}
      onShowBeside={columnFills && threadLayout.roomy ? showBeside : undefined}
      onShowFull={columnFills || besideForSecond ? undefined : showFull}
    />
  );
  const timelineProps: RoomTimelineProps = {
    room,
    // The event the address names is the thread's, unless it asks for it in the room.
    eventId: openThreadId && !focusEventInRoom ? undefined : eventId,
    focusEventInRoom,
    entryKey,
    entryPushed,
    hasMindroomAgents,
    summaryMap: threadState.summaryMap,
    onStoreThreadSummary: threadState.storeThreadSummary,
    threadFilterState: threadState.threadFilterState,
    threadSortFreezeState: threadState.threadSortFreezeState,
    setThreadSortFreezeState: threadState.setThreadSortFreezeState,
    onSortDirectionChange: threadState.handleSortDirectionChange,
    onToggleThreadSortFreeze: threadState.handleToggleThreadSortFreeze,
    onToggleUnresolvedOnly: threadState.handleToggleUnresolvedOnly,
    onTogglePerson: threadState.handleTogglePerson,
    onClearPeople: threadState.handleClearPeople,
    onReset: threadState.handleReset,
    onAddTag: threadState.handleAddTag,
    onRemoveTag: threadState.handleRemoveTag,
    onClearTags: threadState.handleClearTags,
    onSelectTab: threadState.handleSelectTab,
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
    <Page ref={pageRef} style={openThreadId ? PAGE_ROW_STYLE : PAGE_STYLE}>
      <ConversationLayout
        room={room}
        areaRef={areaRef}
        // The plugins' slot shows under the header people see: the column's as it fills.
        header={(headerRef) => (
          <>
            <RoomViewHeader
              hasMindroomAgents={hasMindroomAgents}
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
        collapsed={columnFills}
        conversationRef={conversationRef}
      >
        <ConversationCover key={roomId} room={room} conversationRef={conversationRef} />
      </ConversationLayout>
      {openThreadId && (
        <ResizablePanel
          side="end"
          storageKey={THREAD_COLUMN_WIDTH_KEY}
          defaultWidth={THREAD_COLUMN_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={THREAD_COLUMN_MAX_WIDTH}
          fullWidth={columnFills}
          resizeLabel={t('thread.resize')}
          // While a second thread keeps it beside the messages, filling the page would not take.
          onExpand={besideForSecond ? undefined : showFull}
          expandLabel={t('thread.showFull')}
          testId="thread-column"
          onKeyDown={noteThreadColumnKey}
        >
          <div ref={columnRef} style={COLUMN_STYLE}>
            {threadState.threadNotFound ? (
              // A thread that is not this room's, nor of any joined room the client knows. Filling
              // the page, the column has the room's header the room area hides.
              <>
                {columnFills && (
                  <RoomViewHeader
                    hasMindroomAgents={hasMindroomAgents}
                    threadId={openThreadId}
                    threadFilterState={threadState.threadFilterState}
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
                threadId={openThreadId}
                eventId={focusEventInRoom ? undefined : eventId}
                forkAt={forkAt}
                header={threadBanner}
                // The banner's title follows the summaries the thread's own events bring.
                summaryMap={timelineProps.summaryMap}
                onStoreThreadSummary={timelineProps.onStoreThreadSummary}
                // Filling the page, the column has the room's header the room area hides.
                roomHeader={
                  columnFills
                    ? (headerRef) => (
                        <>
                          <RoomViewHeader
                            hasMindroomAgents={hasMindroomAgents}
                            threadId={openThreadId}
                            threadFilterState={threadState.threadFilterState}
                            {...headerProps}
                          />
                          <RoomHeaderSlot room={room} headerRef={headerRef} />
                        </>
                      )
                    : undefined
                }
                // Beside the messages, where typing goes to the room's composer, it takes the focus,
                // and from the room's composer whose send opened it. ThreadView reads it as the
                // thread opens, in the effects of the commit that opens it, before this view's reset.
                autoFocus={!columnFills || focusOpenedThread.current}
                hidden={behindPanel}
                onThreadLoadError={threadLoadFailed}
                onUnmount={onColumnGone}
                focusRef={focusColumn}
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
