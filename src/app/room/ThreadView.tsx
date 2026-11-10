import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { Box } from 'folds';
import { ThreadApprovalQueue } from '../approvals/ThreadApprovalControls';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import { RoomInput } from '../composer/RoomInput';
import { useEditor } from '../editor/Editor';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
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
  shownConversationViewsAtom,
} from '../navigation/conversationView';
import { RoomTimeline } from '../timeline/RoomTimeline';
import { MessageLinkCards } from './MessageLinkCards';

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
 * The thread `threadId` (its root's event ID) of `room` as the room's page shows it, for a client
 * plugin's surface (`ThreadView` of `@mindroom/client-sdk/room`): its root and replies with their
 * message actions and link cards, the thread's tool approvals under them, and the composer under
 * those while the signed-in account may post in the room. It is a conversation view of its own
 * (`ConversationViewContext`), also beside the room's page of the same room: its composer has its
 * own reply and staged files, and it counts as on screen while the room's page is behind a panel.
 * The text being written is the thread's draft, the same as on the room's page. Timeline and
 * composer share one editor, as in the room view; it has no filter bar or thread summaries, and
 * the whole view takes dropped files. It adds no key handling of its own, so an Escape the
 * composer and its menus leave bubbles out of it.
 */
export function ThreadView({ room, threadId }: { room: Room; threadId: string }) {
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

  // Notifications count the thread as on screen while the view shows it.
  const setShownViews = useSetAtom(shownConversationViewsAtom);
  const { roomId } = room;
  useEffect(() => {
    const place = { roomId, threadId };
    setShownViews((shown) => [...shown, place]);
    return () => setShownViews((shown) => shown.filter((other) => other !== place));
  }, [roomId, setShownViews, threadId]);

  const focusConversation = useCallback(() => ReactEditor.focus(editor as ReactEditor), [editor]);

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
