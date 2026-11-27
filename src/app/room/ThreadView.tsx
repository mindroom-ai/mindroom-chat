import {
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import { useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { RoomInput } from '../composer/RoomInput';
import { useEditor } from '../editor/Editor';
import {
  isLocalEchoEventId,
  resolveCanonicalThreadRootId,
} from '../event-store/threads/threadRouteUtils';
import { isEventId } from '../lib/matrixIds';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../event-store/timeline/roomTimelineViewState';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { PowerLevelsContextProvider, usePowerLevels } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { hasActiveMindroomAgent } from '../matrix/protocol/agentIdentity';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { StateEvent } from '../matrix/types/room';
import {
  ConversationViewContext,
  composerStateKey,
  useShownConversationView,
} from '../navigation/conversationView';
import {
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
} from '../composer/roomInputDrafts';
import { RoomTimeline, type RoomTimelineProps } from '../timeline/RoomTimeline';
import { usePanelFrame } from '../ui/panels/panelFrameContext';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { MessageLinkCards } from './MessageLinkCards';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { PaneCollapsedContext, usePaneCollapsed } from '../lib/hooks/usePaneCollapsed';
import { ComposerNotice, ConversationLayout } from './ConversationLayout';
import { useLocalEchoRoot } from './useLocalEchoRoot';
import { CrossRoomForkDraftBanner } from '../threads/fork/CrossRoomForkDraftBanner';

const NO_SUMMARIES: ReadonlyMap<string, ThreadSummaryInfo> = new Map();
const ignore = () => undefined;
const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';

/**
 * The app side of `ThreadView` in `@mindroom/client-sdk/room`, whose contract lives there and in
 * docs/client-plugins.md "ThreadView". It is a conversation view of its own
 * (`ConversationViewContext`), shown
 * (`shownConversationViewsAtom`) while its side panel is not folded, and draws the thread as the
 * room page draws a conversation (`ConversationLayout`): the timeline, with the typing notice, the
 * composer (or why there is none, and the Retry of a root that did not send) and read receipts
 * floating under it, and the thread's background jobs and approvals above the composer. Timeline
 * and composer share one editor, as in the room view; it has no filter bar, the whole view takes
 * dropped files, and it adds no key handling of its own. The room page's thread column gives it
 * the thread's banner as its `header`, the room's header as `roomHeader` while it fills the page,
 * the page's thread summaries (`summaryMap`, `onStoreThreadSummary`), the column as its
 * `fileDropContainerRef` (the column's header takes dropped files too), the event its address
 * names, the focus as it opens (`autoFocus`, read as a thread opens or changes), `hidden` while a
 * side panel takes the page's place, the page's handler of a thread that does not load,
 * `onUnmount`, which gets the thread it showed last as it goes, and `focusRef`. With `forkAt` it is
 * a fork draft: the thread up to that message and a composer whose first message starts the fork,
 * then opens it here.
 */
export function ThreadView({
  room,
  sourceRoom,
  threadId,
  eventId,
  forkAt,
  onExitCrossRoomFork,
  header,
  autoFocus = false,
  hidden = false,
  passive = false,
  onThreadLoadError,
  onUnmount,
  focusRef,
  fileDropContainerRef,
  roomHeader,
  summaryMap = NO_SUMMARIES,
  onStoreThreadSummary = ignore,
}: {
  room: Room;
  /** In a cross-room fork draft, the room whose thread is previewed (read scope); sends go to `room`. */
  sourceRoom?: Room;
  threadId: string;
  eventId?: string;
  /** A fork draft's fork point, a message of the thread (`?forkAt=`). */
  forkAt?: string;
  /** Back action for the default cross-room draft banner when `header` is omitted. */
  onExitCrossRoomFork?: () => void;
  header?: ReactNode;
  autoFocus?: boolean;
  hidden?: boolean;
  /** True while mounted passively during an uncommitted swipe preview. */
  passive?: boolean;
  onThreadLoadError?: (threadId: string) => void;
  onUnmount?: (threadId: string) => void;
  /** Holds, while it is mounted, the function that takes the focus to its composer. */
  focusRef?: MutableRefObject<(() => void) | undefined>;
  /** The element whose dropped files its composer takes, in place of the view. */
  fileDropContainerRef?: RefObject<HTMLElement | null>;
  /** The room's header, over the thread as over the room's messages, given its element. */
  roomHeader?: (headerRef: RefObject<HTMLDivElement | null>) => ReactNode;
  /** The room page's thread summaries, which the thread's own events bring up to date. */
  summaryMap?: ReadonlyMap<string, ThreadSummaryInfo>;
  onStoreThreadSummary?: RoomTimelineProps['onStoreThreadSummary'];
}) {
  const client = useMatrixClient();
  const editor = useEditor();
  const view = useId();
  const viewRef = useRef<HTMLDivElement>(null);
  const readRoom = sourceRoom ?? room;
  const isCrossRoomDraft = Boolean(sourceRoom && sourceRoom.roomId !== room.roomId);
  const readMembers = useRoomMembers(client, readRoom.roomId);
  const hasMindroomAgents = useMemo(() => hasActiveMindroomAgent(readMembers), [readMembers]);
  const targetPowerLevels = usePowerLevels(room);
  const readPowerLevels = usePowerLevels(readRoom);
  const permissions = useRoomPermissions(useRoomCreators(room), targetPowerLevels);
  // As in the room view, an upgraded room takes no more messages.
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  const myUserId = client.getSafeUserId();
  const canMessage = permissions.event('m.room.message', myUserId);
  const composerShown = !tombstone && canMessage;
  // Cancelling a background job sends an event, so it takes that event's power level.
  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, myUserId);
  const localRoot = useLocalEchoRoot(room, isCrossRoomDraft ? undefined : threadId);
  const failedRoot =
    localRoot.pending && localRoot.event && isFailedLocalEchoEvent(localRoot.event)
      ? localRoot.event
      : undefined;

  // The view shows, for read receipts and notifications, while it is mounted, but not while the
  // side panel it is in is folded to its tab, which keeps it mounted out of sight, nor while hidden.
  // A cross-room fork draft still registers its view so its composer and menus stay active,
  // without claiming that `threadId` belongs to `roomId`.
  const folded = usePanelFrame()?.layout === 'folded';
  const outOfSight = folded || hidden;
  const parentCollapsed = usePaneCollapsed();
  const { roomId } = room;
  useShownConversationView(
    !outOfSight,
    view,
    isCrossRoomDraft ? undefined : roomId,
    isCrossRoomDraft ? undefined : threadId
  );

  // Its composer's reply and staged files, in each room it showed, go with it as it unmounts: no
  // later view finds them. Until then they stay, as a send under way may still use them.
  const roomsShown = useRef(new Set<string>()).current;
  roomsShown.add(roomId);
  const last = useLatestRef({ threadId, onUnmount });
  useEffect(
    () => () => {
      last.current.onUnmount?.(last.current.threadId);
      roomsShown.forEach((shownRoomId) => {
        roomIdToReplyDraftAtomFamily.remove(composerStateKey(shownRoomId, view));
        roomIdToUploadItemsAtomFamily.remove(composerStateKey(shownRoomId, view));
      });
    },
    [last, roomsShown, view]
  );

  // The fork draft: the thread up to the fork point, read-only, and a composer whose first message
  // starts the fork, then opens it in the draft's place. A point that is not among the thread's
  // messages makes a fork without its parent's messages, as a missing reference does.
  const { navigateRoomThread } = useRoomNavigate();
  const draftForkAt = isEventId(forkAt) ? forkAt : undefined;
  const forkFrom = useMemo(
    () =>
      draftForkAt
        ? {
            ...(isCrossRoomDraft ? { roomId: readRoom.roomId } : {}),
            threadId,
            eventId: draftForkAt,
          }
        : undefined,
    [draftForkAt, isCrossRoomDraft, readRoom.roomId, threadId]
  );
  const store = useStore();
  const openFork = useCallback(
    (forkRootId: string) => {
      // A reply chosen in the thread before the draft would take the fork's next message back
      // into the thread: the fork starts without it.
      store.set(roomIdToReplyDraftAtomFamily(composerStateKey(roomId, view)), undefined);
      navigateRoomThread(roomId, forkRootId, undefined, { replace: true });
      return true;
    },
    [navigateRoomThread, roomId, store, view]
  );

  const focusConversation = useCallback(() => ReactEditor.focus(editor), [editor]);
  useEffect(() => {
    if (!focusRef) return undefined;
    focusRef.current = composerShown ? focusConversation : undefined;
    return () => {
      focusRef.current = undefined;
    };
  }, [composerShown, focusConversation, focusRef]);
  // Without a composer on screen there is nothing to focus. A root that gets its own ID is the
  // same thread: the focus stays where the person took it meanwhile. `autoFocus` counts as a thread
  // opens or changes: changing it alone (the column changing width) moves no focus.
  const previousThreadId = useRef<string>(undefined);
  const autoFocusRef = useLatestRef(autoFocus);
  useEffect(() => {
    const previous = previousThreadId.current;
    previousThreadId.current = threadId;
    const rootConfirmed =
      isLocalEchoEventId(previous) && resolveCanonicalThreadRootId(room, previous) === threadId;
    if (autoFocusRef.current && !rootConfirmed) focusConversation();
  }, [autoFocusRef, focusConversation, room, threadId]);
  // A fork draft opens to its composer.
  const forkKey = forkFrom && `${forkFrom.roomId ?? ''}\n${forkFrom.threadId}\n${forkFrom.eventId}`;
  useEffect(() => {
    if (forkKey) focusConversation();
  }, [focusConversation, forkKey]);

  const resolvedHeader =
    header ??
    (forkFrom ? (
      <CrossRoomForkDraftBanner
        sourceRoom={readRoom}
        targetRoom={room}
        canCompose={composerShown}
        onBack={isCrossRoomDraft ? onExitCrossRoomFork : undefined}
      />
    ) : undefined);

  return (
    <PaneCollapsedContext.Provider value={folded || parentCollapsed}>
      <ConversationViewContext value={view}>
        <PowerLevelsContextProvider value={targetPowerLevels}>
          <MessageLinkCards roomId={readRoom.roomId}>
            <ConversationLayout
              room={room}
              threadId={isCrossRoomDraft ? undefined : threadId}
              areaRef={viewRef}
              header={roomHeader}
              timeline={
                <PowerLevelsContextProvider value={readPowerLevels}>
                  <RoomTimeline
                    room={readRoom}
                    threadId={threadId}
                    eventId={isCrossRoomDraft ? draftForkAt : eventId}
                    forkAt={draftForkAt}
                    forkTargetRoom={isCrossRoomDraft ? room : undefined}
                    canCompose={composerShown}
                    threadHeader={resolvedHeader}
                    threadHeaderGapAbove={!roomHeader}
                    onThreadLoadError={onThreadLoadError}
                    viewMode="threaded"
                    hasMindroomAgents={hasMindroomAgents}
                    editor={editor}
                    summaryMap={isCrossRoomDraft ? NO_SUMMARIES : summaryMap}
                    onStoreThreadSummary={isCrossRoomDraft ? ignore : onStoreThreadSummary}
                    threadFilterState={DIRECT_ROOM_TIMELINE_FILTER_STATE}
                  />
                </PowerLevelsContextProvider>
              }
              focusConversation={focusConversation}
              canCancelJobs={canCancelJobs}
              readOnly={!!forkFrom}
              passive={passive}
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
                    threadId={forkFrom ? undefined : threadId}
                    forkFrom={forkFrom}
                    onRoomMessageSent={forkFrom ? openFork : undefined}
                    editor={editor}
                    fileDropContainerRef={fileDropContainerRef ?? viewRef}
                  />
                )
              }
            />
          </MessageLinkCards>
        </PowerLevelsContextProvider>
      </ConversationViewContext>
    </PaneCollapsedContext.Provider>
  );
}
