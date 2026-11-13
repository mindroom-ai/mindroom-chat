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
import type { Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { RoomInput } from '../composer/RoomInput';
import { useEditor } from '../editor/Editor';
import {
  isLocalEchoEventId,
  resolveCanonicalThreadRootId,
} from '../event-store/threads/threadRouteUtils';
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
import { MessageLinkCards } from './MessageLinkCards';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { ComposerNotice, ConversationLayout } from './ConversationLayout';
import { useLocalEchoRoot } from './useLocalEchoRoot';

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
 * `onUnmount`, which gets the thread it showed last as it goes, and `focusRef`.
 */
export function ThreadView({
  room,
  threadId,
  eventId,
  header,
  autoFocus = false,
  hidden = false,
  onThreadLoadError,
  onUnmount,
  focusRef,
  fileDropContainerRef,
  roomHeader,
  summaryMap = NO_SUMMARIES,
  onStoreThreadSummary = ignore,
}: {
  room: Room;
  threadId: string;
  eventId?: string;
  header?: ReactNode;
  autoFocus?: boolean;
  hidden?: boolean;
  onThreadLoadError?: (threadId: string) => void;
  onUnmount?: (threadId: string) => void;
  /** Holds, while it is mounted, the function that takes the focus to its composer. */
  focusRef?: MutableRefObject<(() => void) | undefined>;
  /** The element whose dropped files its composer takes, in place of the view. */
  fileDropContainerRef?: RefObject<HTMLElement>;
  /** The room's header, over the thread as over the room's messages, given its element. */
  roomHeader?: (headerRef: RefObject<HTMLDivElement>) => ReactNode;
  /** The room page's thread summaries, which the thread's own events bring up to date. */
  summaryMap?: ReadonlyMap<string, ThreadSummaryInfo>;
  onStoreThreadSummary?: RoomTimelineProps['onStoreThreadSummary'];
}) {
  const client = useMatrixClient();
  const editor = useEditor();
  const view = useId();
  const viewRef = useRef<HTMLDivElement>(null);
  const members = useRoomMembers(client, room.roomId);
  const hasMindroomAgents = useMemo(() => hasActiveMindroomAgent(members), [members]);
  const powerLevels = usePowerLevels(room);
  const permissions = useRoomPermissions(useRoomCreators(room), powerLevels);
  // As in the room view, an upgraded room takes no more messages.
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  const myUserId = client.getSafeUserId();
  const canMessage = permissions.event('m.room.message', myUserId);
  const composerShown = !tombstone && canMessage;
  // Cancelling a background job sends an event, so it takes that event's power level.
  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, myUserId);
  const localRoot = useLocalEchoRoot(room, threadId);
  const failedRoot =
    localRoot.pending && localRoot.event && isFailedLocalEchoEvent(localRoot.event)
      ? localRoot.event
      : undefined;

  // The view shows, for read receipts and notifications, while it is mounted, but not while the
  // side panel it is in is folded to its tab, which keeps it mounted out of sight, nor while hidden.
  const outOfSight = usePanelFrame()?.layout === 'folded' || hidden;
  const { roomId } = room;
  useShownConversationView(!outOfSight, view, roomId, threadId);

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

  const focusConversation = useCallback(() => ReactEditor.focus(editor), [editor]);
  useEffect(() => {
    if (!focusRef) return undefined;
    focusRef.current = focusConversation;
    return () => {
      focusRef.current = undefined;
    };
  }, [focusConversation, focusRef]);
  // Without a composer on screen there is nothing to focus. A root that gets its own ID is the
  // same thread: the focus stays where the person took it meanwhile. `autoFocus` counts as a thread
  // opens or changes: changing it alone (the column changing width) moves no focus.
  const previousThreadId = useRef<string>();
  const autoFocusRef = useLatestRef(autoFocus);
  useEffect(() => {
    const previous = previousThreadId.current;
    previousThreadId.current = threadId;
    const rootConfirmed =
      isLocalEchoEventId(previous) && resolveCanonicalThreadRootId(room, previous) === threadId;
    if (autoFocusRef.current && !rootConfirmed) focusConversation();
  }, [autoFocusRef, focusConversation, room, threadId]);

  return (
    <ConversationViewContext.Provider value={view}>
      <PowerLevelsContextProvider value={powerLevels}>
        <MessageLinkCards roomId={roomId}>
          <ConversationLayout
            room={room}
            threadId={threadId}
            areaRef={viewRef}
            header={roomHeader}
            timeline={
              <RoomTimeline
                room={room}
                threadId={threadId}
                eventId={eventId}
                threadHeader={header}
                onThreadLoadError={onThreadLoadError}
                viewMode="threaded"
                hasMindroomAgents={hasMindroomAgents}
                editor={editor}
                summaryMap={summaryMap}
                onStoreThreadSummary={onStoreThreadSummary}
                threadFilterState={DIRECT_ROOM_TIMELINE_FILTER_STATE}
              />
            }
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
                  threadId={threadId}
                  editor={editor}
                  fileDropContainerRef={fileDropContainerRef ?? viewRef}
                />
              )
            }
          />
        </MessageLinkCards>
      </PowerLevelsContextProvider>
    </ConversationViewContext.Provider>
  );
}
