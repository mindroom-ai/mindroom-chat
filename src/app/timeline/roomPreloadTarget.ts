import type { RoomViewMode } from '../navigation/roomViewMode';

export const shouldUseSurfacePreloadTarget = ({
  threadId,
  roomThreadFilterActive,
  viewMode,
}: {
  threadId: string | undefined;
  roomThreadFilterActive: boolean;
  viewMode: RoomViewMode | undefined;
}) => !threadId && (roomThreadFilterActive || viewMode === 'compact');
