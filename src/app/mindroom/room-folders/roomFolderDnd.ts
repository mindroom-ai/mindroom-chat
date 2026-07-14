import { RoomToParents } from '../../../types/matrix/room';
import { RoomNavCategoryKind } from './roomFolderNavRows';

export type RoomFolderDropTarget = {
  categoryKind: RoomNavCategoryKind;
  parentId?: string;
  roomOrderKey: string;
  targetRoomId?: string;
};

export type RoomFolderDropAction =
  | { type: 'move-personal'; roomId: string; folderId?: string }
  | { type: 'add-to-space'; roomId: string; spaceId: string };

export const placeRoomInOrder = (
  roomIds: string[],
  roomId: string,
  targetRoomId?: string
): string[] => {
  const order = roomIds.filter((id) => id !== roomId);
  const targetIndex = targetRoomId ? order.indexOf(targetRoomId) : -1;
  order.splice(targetIndex < 0 ? order.length : targetIndex, 0, roomId);
  return order;
};

export const resolveRoomFolderDrop = (
  roomId: string,
  target: RoomFolderDropTarget,
  roomToParents: RoomToParents,
  currentFolderId?: string
): RoomFolderDropAction | undefined => {
  if (target.categoryKind === 'folder' && target.parentId) {
    return { type: 'move-personal', roomId, folderId: target.parentId };
  }
  if (target.categoryKind === 'unfiled') {
    // A Matrix-space child that has no personal folder cannot appear in Rooms;
    // treating this as a move would announce success without changing the UI.
    if (roomToParents.has(roomId) && !currentFolderId) return undefined;
    return { type: 'move-personal', roomId };
  }
  if (
    target.categoryKind === 'space' &&
    target.parentId &&
    !roomToParents.get(roomId)?.has(target.parentId)
  ) {
    return { type: 'add-to-space', roomId, spaceId: target.parentId };
  }
  return undefined;
};
