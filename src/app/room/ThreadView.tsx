import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { Box } from 'folds';
import { ThreadApprovalQueue } from '../approvals/ThreadApprovalControls';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import { RoomInput } from '../composer/RoomInput';
import { useEditor } from '../editor/Editor';
import {
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
} from '../event-store/threads/threadRouteUtils';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../event-store/timeline/roomTimelineViewState';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { PowerLevelsContextProvider, usePowerLevels } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { hasActiveMindroomAgent } from '../matrix/protocol/agentIdentity';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { StateEvent } from '../matrix/types/room';
import {
  ConversationViewContext,
  composerStateKey,
  shownConversationViewsAtom,
} from '../navigation/conversationView';
import {
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
} from '../composer/roomInputDrafts';
import { RoomTimeline } from '../timeline/RoomTimeline';
import { usePanelFrame } from '../ui/panels/panelFrameContext';
import { MessageLinkCards } from './MessageLinkCards';
import { useLatestRef } from '../lib/hooks/useLatestRef';

const NO_SUMMARIES: ReadonlyMap<string, ThreadSummaryInfo> = new Map();
const ignore = () => undefined;

// It fills its parent, a flex column. No floating header or composer covers its rows, so the
// insets the room view measures for them are none here.
const VIEW_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  '--room-header-height': '0px',
  '--room-footer-height': '0px',
  '--room-composer-height': '0px',
} as CSSProperties;
const TIMELINE_STYLE: CSSProperties = { minHeight: 0, minWidth: 0 };

/**
 * The app side of `ThreadView` in `@mindroom/client-sdk/room`, whose contract lives there and in
 * docs/architecture.md. It is a conversation view of its own (`ConversationViewContext`), shown
 * (`shownConversationViewsAtom`) while its side panel is not folded. Timeline and composer share
 * one editor, as in the room view; it has no filter bar or thread summaries, the whole view takes
 * dropped files, and it adds no key handling of its own. The room page's thread column gives it
 * the thread's banner as its `header`, the event its address names, the focus as it opens,
 * `hidden` while a side panel takes the page's place, the page's handler of a thread that does not
 * load, and `onUnmount`, which gets the thread it showed last as it goes.
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
}: {
  room: Room;
  threadId: string;
  eventId?: string;
  header?: ReactNode;
  autoFocus?: boolean;
  hidden?: boolean;
  onThreadLoadError?: (threadId: string) => void;
  onUnmount?: (threadId: string) => void;
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
  const composerShown = !tombstone && permissions.event('m.room.message', client.getSafeUserId());

  // The view shows, for read receipts and notifications, while it is mounted, but not while the
  // side panel it is in is folded to its tab, which keeps it mounted out of sight, nor while hidden.
  const outOfSight = usePanelFrame()?.layout === 'folded' || hidden;
  const setShownViews = useSetAtom(shownConversationViewsAtom);
  const { roomId } = room;
  useEffect(() => {
    if (outOfSight) return undefined;
    const place = { view, roomId, threadId };
    setShownViews((shown) => [...shown, place]);
    return () => setShownViews((shown) => shown.filter((other) => other !== place));
  }, [outOfSight, roomId, setShownViews, threadId, view]);

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
  // Without a composer on screen there is nothing to focus. A root that gets its own ID is the
  // same thread: the focus stays where the person took it meanwhile.
  const focusedThread = useRef<string>();
  useEffect(() => {
    const confirmedRoot = isLocalEchoEventId(focusedThread.current);
    focusedThread.current = threadId;
    if (autoFocus && !confirmedRoot) focusConversation();
  }, [autoFocus, focusConversation, threadId]);

  return (
    <ConversationViewContext.Provider value={view}>
      <div ref={viewRef} style={VIEW_STYLE}>
        <PowerLevelsContextProvider value={powerLevels}>
          <MessageLinkCards roomId={roomId}>
            <ThreadApprovalProvider
              room={room}
              // A message not yet on the server has no approvals, and no relations to ask for.
              threadId={isConfirmedMatrixEventId(threadId) ? threadId : undefined}
              focusConversation={focusConversation}
            >
              <Box grow="Yes" direction="Column" style={TIMELINE_STYLE}>
                <RoomTimeline
                  room={room}
                  threadId={threadId}
                  eventId={eventId}
                  threadHeader={header}
                  onThreadLoadError={onThreadLoadError}
                  viewMode="threaded"
                  hasMindroomAgents={hasMindroomAgents}
                  editor={editor}
                  summaryMap={NO_SUMMARIES}
                  onStoreThreadSummary={ignore}
                  threadFilterState={DIRECT_ROOM_TIMELINE_FILTER_STATE}
                />
              </Box>
              <ThreadApprovalQueue />
            </ThreadApprovalProvider>
          </MessageLinkCards>
          {composerShown && (
            <RoomInput
              room={room}
              roomId={roomId}
              threadId={threadId}
              editor={editor}
              fileDropContainerRef={viewRef}
            />
          )}
        </PowerLevelsContextProvider>
      </div>
    </ConversationViewContext.Provider>
  );
}
