import { MatrixClient } from 'matrix-js-sdk';
import { RoomToParents, RoomToUnread } from '../../../types/matrix/room';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { factoryRoomIdByActivity, factoryRoomIdByAtoZ } from '../../utils/sort';
import {
  RoomFolder,
  RoomOrder,
  UNFILED_ROOM_ORDER_KEY,
  applyCanonicalRoomOrder,
  makeFolderRoomOrderKey,
  makeSpaceRoomOrderKey,
} from './roomFolders';

export type RoomNavCategoryKind = 'folder' | 'space' | 'unfiled';

type HeaderRow = {
  type: 'header';
  key: string;
  categoryId: string;
  roomOrderKey: string;
  categoryKind: RoomNavCategoryKind;
  folder?: RoomFolder;
  spaceId?: string;
};
type RoomRow = {
  type: 'room';
  key: string;
  roomId: string;
  categoryId: string;
  roomOrderKey: string;
  categoryKind: RoomNavCategoryKind;
  parentId?: string;
};
export type RoomFolderNavRow = HeaderRow | RoomRow;

export const collectRoomIdsByOrderKey = (rows: RoomFolderNavRow[]): Map<string, string[]> =>
  rows.reduce<Map<string, string[]>>((roomIdsByOrderKey, row) => {
    if (row.type === 'room') {
      const roomIds = roomIdsByOrderKey.get(row.roomOrderKey) ?? [];
      roomIds.push(row.roomId);
      roomIdsByOrderKey.set(row.roomOrderKey, roomIds);
    }
    return roomIdsByOrderKey;
  }, new Map());

export const buildRoomFolderNavRows = (
  mx: MatrixClient,
  roomIds: string[],
  spaceIds: string[],
  roomToParents: RoomToParents,
  folders: RoomFolder[],
  roomOrder: RoomOrder,
  closedCategories: Set<string>,
  roomToUnread: RoomToUnread,
  selectedRoomId?: string
): RoomFolderNavRow[] => {
  const availableRoomIds = new Set(roomIds);
  const assignedRoomIds = new Set(folders.flatMap((folder) => folder.roomIds));
  const categories: Array<{
    kind: RoomNavCategoryKind;
    folder?: RoomFolder;
    spaceId?: string;
    roomIds: string[];
    categoryId: string;
    roomOrderKey: string;
  }> = [
    ...folders.map((folder) => ({
      kind: 'folder' as const,
      folder,
      roomIds: folder.roomIds.filter((roomId) => availableRoomIds.has(roomId)),
      categoryId: makeNavCategoryId('home', `room-folder-${folder.id}`),
      roomOrderKey: makeFolderRoomOrderKey(folder.id),
    })),
    ...Array.from(spaceIds)
      .sort(factoryRoomIdByAtoZ(mx))
      .map((spaceId) => ({
        kind: 'space' as const,
        spaceId,
        roomIds: roomIds.filter((roomId) => roomToParents.get(roomId)?.has(spaceId)),
        categoryId: makeNavCategoryId('home', `room-space-${spaceId}`),
        roomOrderKey: makeSpaceRoomOrderKey(spaceId),
      })),
    {
      kind: 'unfiled' as const,
      roomIds: roomIds.filter(
        (roomId) => !assignedRoomIds.has(roomId) && !roomToParents.has(roomId)
      ),
      categoryId: makeNavCategoryId('home', 'room'),
      roomOrderKey: UNFILED_ROOM_ORDER_KEY,
    },
  ];

  return categories.flatMap(
    ({ kind, folder, spaceId, roomIds: categoryRoomIds, categoryId, roomOrderKey }) => {
      const closed = closedCategories.has(categoryId);
      const sortedRoomIds = closed
        ? Array.from(categoryRoomIds).sort(factoryRoomIdByActivity(mx))
        : applyCanonicalRoomOrder(mx, categoryRoomIds, roomOrder[roomOrderKey] ?? [], spaceId);
      const visibleRoomIds = closed
        ? sortedRoomIds.filter((roomId) => roomToUnread.has(roomId) || roomId === selectedRoomId)
        : sortedRoomIds;

      return [
        {
          type: 'header' as const,
          key: `header:${categoryId}`,
          categoryId,
          roomOrderKey,
          categoryKind: kind,
          folder,
          spaceId,
        },
        ...visibleRoomIds.map((roomId) => ({
          type: 'room' as const,
          key: `room:${categoryId}:${roomId}`,
          roomId,
          categoryId,
          roomOrderKey,
          categoryKind: kind,
          parentId: kind === 'space' ? spaceId : folder?.id,
        })),
      ];
    }
  );
};
