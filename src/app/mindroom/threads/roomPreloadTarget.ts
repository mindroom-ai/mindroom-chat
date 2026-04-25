import type { RoomViewMode } from '../../state/room/roomViewMode';

export const shouldUseSurfacePreloadTarget = ({
  threadId,
  roomThreadFilterActive,
  viewMode,
}: {
  threadId: string | undefined;
  roomThreadFilterActive: boolean;
  viewMode: RoomViewMode | undefined;
}) => !threadId && (roomThreadFilterActive || viewMode === 'compact');
