import { useRef } from 'react';
import { Direction } from 'matrix-js-sdk';
import { Box } from 'folds';
import type { ScrollAnchorMemory } from '../ui/scrollAnchorMemory';
import { CompactRoomView } from '../threads/overview/CompactRoomView';
import { takeCompactFocusRequest } from '../threads/overview/compactFocusRequest';
import { useCompactHistoryAtEnd } from '../threads/overview/useCompactHistoryAtEnd';
import type { RoomTimelineProps } from './RoomTimeline';
import type { RoomSurfaceState } from './RoomSurface';

const NOOP = () => undefined;

export function CompactRoomSurface({
  props,
  state,
}: {
  props: RoomTimelineProps;
  state: RoomSurfaceState;
}) {
  const { room, eventId, focusEventInRoom, threadFilterState } = props;
  const { threadIndex } = state;
  const fallbackScrollStateRef = useRef<ScrollAnchorMemory>(new Map());
  const compactRoomScrollStateRef = props.compactRoomScrollStateRef ?? fallbackScrollStateRef;
  const compactHostRef = useRef<HTMLDivElement>(null);
  useCompactHistoryAtEnd({
    enabled: !eventId,
    roomId: room.roomId,
    hostRef: compactHostRef,
    canPaginateBack:
      typeof state.firstRoomTimeline?.getPaginationToken(Direction.Backward) === 'string',
    hasMoreCachedBack: state.roomHasMoreCachedBack,
    paginateBack: state.paginateRoom,
  });
  const focusRequest =
    eventId && focusEventInRoom
      ? {
          eventId,
          entryKey: props.entryKey,
          pushed: props.entryPushed,
          returned: props.entryReturned,
        }
      : undefined;
  if (focusRequest) {
    takeCompactFocusRequest(compactRoomScrollStateRef.current, room.roomId, focusRequest);
  }
  return (
    <Box ref={compactHostRef} grow="Yes" direction="Column" style={state.roomStyle}>
      {state.filterBar}
      <CompactRoomView
        room={room}
        threadRootIds={threadIndex.compactOverviewOrdering.displayOrderedIds}
        threadRecordMap={threadIndex.compactThreadRecordMap}
        onThreadClick={(rootId) => state.env.navigateRoomThread(room.roomId, rootId)}
        compactRoomScrollStateRef={compactRoomScrollStateRef}
        focusRequest={focusRequest}
        indexPending={
          (eventId ? state.clientCatchingUp : state.hydrating) || threadIndex.threadListLoading
        }
        focusScope={threadIndex.threadSortControlSignature}
        filterBarShown={state.filterBarShown}
        sectionsNow={state.threadSectionsShown ? threadIndex.snoozeNow : undefined}
        singleBucketTab={
          state.threadSectionsShown && threadFilterState.tab && threadFilterState.tab !== 'all'
            ? threadFilterState.tab
            : undefined
        }
        emptyState={{
          filterState: threadFilterState,
          now: threadIndex.snoozeNow,
          canCompose: state.trusted.canCompose,
          onReset: props.onReset ?? NOOP,
          onToggleForMe: props.onToggleForMe,
          onShowSnoozed: props.onShowSnoozed ?? props.onReset ?? NOOP,
        }}
      />
    </Box>
  );
}
