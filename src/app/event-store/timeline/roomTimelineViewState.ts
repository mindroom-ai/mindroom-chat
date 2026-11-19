import type { ThreadFilterState } from '../threads/roomThreadOverviewModel';
import type { RoomViewMode } from '../../navigation/roomViewMode';

export const DIRECT_ROOM_TIMELINE_FILTER_STATE: ThreadFilterState = {
  resolved: 'any',
  snoozed: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
};

export const THREAD_OVERVIEW_METADATA_CACHE_LIMIT = 64;

/**
 * The filter the Compact cards are listed by. In sections, Later is where snoozed threads go, so the
 * default that keeps them out of the flat cards (`snoozed: 'exclude'`) does not apply. Only the
 * listing drops it: the filter bar and the stored filter keep it, so the flat cards still hide
 * snoozed threads and a search typed while grouped saves it unchanged.
 */
export const listedThreadFilterState = (
  state: ThreadFilterState,
  threadSections: boolean
): ThreadFilterState =>
  threadSections && state.snoozed === 'exclude' ? { ...state, snoozed: 'any' } : state;

export type RoomTimelineViewState = {
  focusedRoomOverviewRequested: boolean;
  requestedThreadFilterState: ThreadFilterState;
  showRoomThreadOverviewControls: boolean;
};

export const resolveRoomTimelineViewState = ({
  eventId,
  focusEventInRoom,
  threadFilterState,
  threadId,
  viewMode,
}: {
  eventId?: string;
  focusEventInRoom?: boolean;
  threadFilterState: ThreadFilterState;
  threadId?: string;
  viewMode: RoomViewMode;
}): RoomTimelineViewState => ({
  focusedRoomOverviewRequested: Boolean(
    !threadId && focusEventInRoom && viewMode === 'threaded' && eventId
  ),
  requestedThreadFilterState:
    viewMode === 'classic' ? DIRECT_ROOM_TIMELINE_FILTER_STATE : threadFilterState,
  showRoomThreadOverviewControls: !threadId && viewMode !== 'classic',
});
