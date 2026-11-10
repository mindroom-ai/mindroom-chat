import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useSetAtom, useStore } from 'jotai';
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
  composerStateKey,
  shownConversationViewsAtom,
} from '../navigation/conversationView';
import {
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../composer/roomInputDrafts';
import { UploadStatus } from '../matrix/state/upload';
import { RoomTimeline } from '../timeline/RoomTimeline';
import { usePanelFrame } from '../ui/panels/panelFrameContext';
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
 * The app side of `ThreadView` in `@mindroom/client-sdk/room`, whose contract lives there and in
 * docs/architecture.md. It is a conversation view of its own (`ConversationViewContext`), shown
 * (`shownConversationViewsAtom`) while its side panel is not folded. Timeline and composer share
 * one editor, as in the room view; it has no filter bar or thread summaries, the whole view takes
 * dropped files, and it adds no key handling of its own.
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

  // The view shows, for read receipts and notifications, while it is mounted, but not while the
  // side panel it is in is folded to its tab, which keeps it mounted out of sight.
  const folded = usePanelFrame()?.layout === 'folded';
  const setShownViews = useSetAtom(shownConversationViewsAtom);
  const { roomId } = room;
  useEffect(() => {
    if (folded) return undefined;
    const place = { view, roomId, threadId };
    setShownViews((shown) => [...shown, place]);
    return () => setShownViews((shown) => shown.filter((other) => other !== place));
  }, [folded, roomId, setShownViews, threadId, view]);

  // Its composer's reply and staged files, in each room it showed, go with it as it unmounts: no
  // later view finds them, and their uploads stop. A send under way took its own files off the
  // list as its composer unmounted (a layout effect, before these passive ones).
  const store = useStore();
  const roomsShown = useRef(new Set<string>()).current;
  roomsShown.add(roomId);
  useEffect(
    () => () =>
      roomsShown.forEach((shownRoomId) => {
        const key = composerStateKey(shownRoomId, view);
        store.get(roomIdToUploadItemsAtomFamily(key)).forEach(({ file }) => {
          const upload = store.get(roomUploadAtomFamily(file));
          if (upload.status !== UploadStatus.Loading) return;
          client.cancelUpload(upload.promise);
          store.set(roomUploadAtomFamily(file), { status: UploadStatus.Idle });
        });
        roomIdToReplyDraftAtomFamily.remove(key);
        roomIdToUploadItemsAtomFamily.remove(key);
      }),
    [client, roomsShown, store, view]
  );

  const focusConversation = useCallback(() => ReactEditor.focus(editor), [editor]);

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
