import { MatrixClient } from 'matrix-js-sdk';
import { RoomToParents, RoomToUnread } from '../../../types/matrix/room';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { factoryRoomIdByActivity, factoryRoomIdByAtoZ } from '../../utils/sort';
import { RoomFolder } from './roomFolders';

export type RoomNavCategoryKind = 'folder' | 'space' | 'unfiled';

type HeaderRow = {
  type: 'header';
  key: string;
  categoryId: string;
  categoryKind: RoomNavCategoryKind;
  folder?: RoomFolder;
  spaceId?: string;
};
type RoomRow = {
  type: 'room';
  key: string;
  roomId: string;
  categoryId: string;
  categoryKind: RoomNavCategoryKind;
  parentId?: string;
};
export type RoomFolderNavRow = HeaderRow | RoomRow;

export const buildRoomFolderNavRows = (
  mx: MatrixClient,
  roomIds: string[],
  spaceIds: string[],
  roomToParents: RoomToParents,
  folders: RoomFolder[],
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
  }> = [
    ...folders.map((folder) => ({
      kind: 'folder' as const,
      folder,
      roomIds: folder.roomIds.filter((roomId) => availableRoomIds.has(roomId)),
      categoryId: makeNavCategoryId('home', `room-folder-${folder.id}`),
    })),
    ...Array.from(spaceIds)
      .sort(factoryRoomIdByAtoZ(mx))
      .map((spaceId) => ({
        kind: 'space' as const,
        spaceId,
        roomIds: roomIds.filter((roomId) => roomToParents.get(roomId)?.has(spaceId)),
        categoryId: makeNavCategoryId('home', `room-space-${spaceId}`),
      })),
    {
      kind: 'unfiled' as const,
      roomIds: roomIds.filter(
        (roomId) => !assignedRoomIds.has(roomId) && !roomToParents.has(roomId)
      ),
      categoryId: makeNavCategoryId('home', 'room'),
    },
  ];

  return categories.flatMap(({ kind, folder, spaceId, roomIds: categoryRoomIds, categoryId }) => {
    const closed = closedCategories.has(categoryId);
    const sortedRoomIds = Array.from(categoryRoomIds).sort(
      closed ? factoryRoomIdByActivity(mx) : factoryRoomIdByAtoZ(mx)
    );
    const visibleRoomIds = closed
      ? sortedRoomIds.filter((roomId) => roomToUnread.has(roomId) || roomId === selectedRoomId)
      : sortedRoomIds;

    return [
      {
        type: 'header' as const,
        key: `header:${categoryId}`,
        categoryId,
        categoryKind: kind,
        folder,
        spaceId,
      },
      ...visibleRoomIds.map((roomId) => ({
        type: 'room' as const,
        key: `room:${categoryId}:${roomId}`,
        roomId,
        categoryId,
        categoryKind: kind,
        parentId: kind === 'space' ? spaceId : folder?.id,
      })),
    ];
  });
};
