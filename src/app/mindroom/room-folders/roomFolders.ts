import { MatrixClient } from 'matrix-js-sdk';
import { MSpaceChildContent, StateEvent } from '../../../types/matrix/room';
import { applyOrderOverride } from '../../state/utils/applyOrderOverride';
import { getStateEvents, isValidChild } from '../../utils/room';
import { byOrderKey, factoryRoomIdByAtoZ } from '../../utils/sort';

export const ROOM_FOLDERS_ACCOUNT_DATA_TYPE = 'io.mindroom.room_folders';

export type RoomFolder = {
  id: string;
  name: string;
  roomIds: string[];
  [key: string]: unknown;
};

export type RoomFoldersAccountData = {
  version?: number;
  folders?: unknown;
  room_order?: unknown;
  [key: string]: unknown;
};

export type RoomOrder = Record<string, string[]>;

export type RoomFolderNavigationState = {
  folders: RoomFolder[];
  roomOrder: RoomOrder;
};

export const UNFILED_ROOM_ORDER_KEY = 'unfiled';
export const makeFolderRoomOrderKey = (folderId: string): string => `folder:${folderId}`;
export const makeSpaceRoomOrderKey = (spaceId: string): string => `space:${spaceId}`;

/**
 * Expanded Home groups and Space pages use one base order so rooms added after
 * the last persisted reorder land in the same place on both surfaces.
 */
export const applyCanonicalRoomOrder = (
  mx: MatrixClient,
  roomIds: string[],
  orderOverride: string[],
  parentSpaceId?: string
): string[] => {
  const compareByName = factoryRoomIdByAtoZ(mx);
  const alphabeticalIds = Array.from(roomIds).sort(
    (roomA, roomB) => compareByName(roomA, roomB) || roomA.localeCompare(roomB)
  );
  const space = parentSpaceId ? mx.getRoom(parentSpaceId) : undefined;
  if (!space) return applyOrderOverride(alphabeticalIds, orderOverride);

  const availableIds = new Set(roomIds);
  const nativeIds = getStateEvents(space, StateEvent.SpaceChild)
    .filter(isValidChild)
    .filter((event) => availableIds.has(event.getStateKey() ?? ''))
    .sort((eventA, eventB) => eventA.getTs() - eventB.getTs())
    .sort((eventA, eventB) =>
      byOrderKey(
        eventA.getContent<MSpaceChildContent>().order,
        eventB.getContent<MSpaceChildContent>().order
      )
    )
    .map((event) => event.getStateKey()!);
  const nativeIdSet = new Set(nativeIds);
  const canonicalIds = [
    ...nativeIds,
    ...alphabeticalIds.filter((roomId) => !nativeIdSet.has(roomId)),
  ];
  return applyOrderOverride(canonicalIds, orderOverride);
};

const isManagedRoomOrderKey = (key: string): boolean =>
  key === UNFILED_ROOM_ORDER_KEY ||
  (key.startsWith('folder:') && key.length > 'folder:'.length) ||
  (key.startsWith('space:') && key.length > 'space:'.length);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Account data is user-editable and can have been written by a newer client.
 * Keep unknown folder fields, reject malformed rows, and make a room's first
 * assignment authoritative when duplicate assignments are encountered.
 */
export const sanitizeRoomFolders = (content: unknown): RoomFolder[] => {
  if (!isRecord(content) || !Array.isArray(content.folders)) return [];

  const folderIds = new Set<string>();
  const assignedRoomIds = new Set<string>();
  const folders: RoomFolder[] = [];

  content.folders.forEach((value) => {
    if (!isRecord(value)) return;

    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!id || !name || folderIds.has(id)) return;

    const roomIds: string[] = [];
    if (Array.isArray(value.room_ids)) {
      value.room_ids.forEach((roomId) => {
        if (typeof roomId !== 'string' || !roomId || assignedRoomIds.has(roomId)) return;
        assignedRoomIds.add(roomId);
        roomIds.push(roomId);
      });
    }

    folderIds.add(id);
    const { room_ids: _roomIds, ...unknownFields } = value;
    folders.push({
      ...unknownFields,
      id,
      name,
      roomIds,
    });
  });

  return folders;
};

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((item): item is string => {
    if (typeof item !== 'string' || !item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
};

export const sanitizeRoomOrder = (content: unknown): RoomOrder => {
  if (!isRecord(content) || !isRecord(content.room_order)) return {};

  return Object.entries(content.room_order).reduce<RoomOrder>((order, [key, value]) => {
    if (!isManagedRoomOrderKey(key)) return order;
    const roomIds = sanitizeStringArray(value);
    if (roomIds.length > 0) order[key] = roomIds;
    return order;
  }, {});
};

export const sanitizeRoomFolderNavigationState = (content: unknown): RoomFolderNavigationState => ({
  folders: sanitizeRoomFolders(content),
  roomOrder: sanitizeRoomOrder(content),
});

export const makeRoomFoldersAccountData = (
  currentContent: unknown,
  folders: RoomFolder[],
  roomOrder?: RoomOrder
): RoomFoldersAccountData => {
  const current = isRecord(currentContent) ? currentContent : {};
  const currentVersion =
    typeof current.version === 'number' && Number.isFinite(current.version)
      ? current.version
      : undefined;
  const content: RoomFoldersAccountData = {
    ...current,
    // Do not relabel account data written by a newer compatible client as v1.
    version: Math.max(1, currentVersion ?? 1),
    folders: sanitizeRoomFolders({
      folders: folders.map(({ roomIds, ...folder }) => ({
        ...folder,
        room_ids: roomIds,
      })),
    }).map(({ roomIds, ...folder }) => ({
      ...folder,
      room_ids: roomIds,
    })),
  };

  if (roomOrder !== undefined) {
    const sanitizedRoomOrder = sanitizeRoomOrder({ room_order: roomOrder });
    const currentRoomOrder = isRecord(current.room_order) ? current.room_order : {};
    const futureRoomOrderFields = Object.fromEntries(
      Object.entries(currentRoomOrder).filter(([key]) => !isManagedRoomOrderKey(key))
    );
    const nextRoomOrder = { ...futureRoomOrderFields, ...sanitizedRoomOrder };
    if (Object.keys(nextRoomOrder).length > 0 || 'room_order' in current) {
      content.room_order = nextRoomOrder;
    } else {
      delete content.room_order;
    }
  }

  return content;
};

export type RoomFoldersMutation = (folders: RoomFolder[]) => RoomFolder[];

export const addRoomFolder = (
  folders: RoomFolder[],
  folder: Pick<RoomFolder, 'id' | 'name'>
): RoomFolder[] => {
  const name = folder.name.trim();
  if (!folder.id || !name || folders.some((item) => item.id === folder.id)) return folders;
  return [...folders, { id: folder.id, name, roomIds: [] }];
};

export const renameRoomFolder = (
  folders: RoomFolder[],
  folderId: string,
  name: string
): RoomFolder[] => {
  const nextName = name.trim();
  if (!nextName) return folders;
  return folders.map((folder) => (folder.id === folderId ? { ...folder, name: nextName } : folder));
};

export const deleteRoomFolder = (folders: RoomFolder[], folderId: string): RoomFolder[] =>
  folders.filter((folder) => folder.id !== folderId);

export const moveRoomToFolder = (
  folders: RoomFolder[],
  roomId: string,
  folderId?: string
): RoomFolder[] => {
  // The target can disappear on another device while this queued mutation is
  // waiting. Keep the latest state intact instead of turning a stale move into
  // an unintended "remove from folder" operation.
  if (folderId && !folders.some((folder) => folder.id === folderId)) return folders;

  return folders.map((folder) => {
    const withoutRoom = folder.roomIds.filter((id) => id !== roomId);
    if (folder.id !== folderId) {
      return withoutRoom.length === folder.roomIds.length
        ? folder
        : { ...folder, roomIds: withoutRoom };
    }
    return { ...folder, roomIds: [...withoutRoom, roomId] };
  });
};

export const setRoomOrder = (
  roomOrder: RoomOrder,
  orderKey: string,
  roomIds: string[]
): RoomOrder => {
  if (!orderKey) return roomOrder;
  const nextIds = sanitizeStringArray(roomIds);
  const currentIds = roomOrder[orderKey] ?? [];
  if (
    nextIds.length === currentIds.length &&
    nextIds.every((roomId, index) => roomId === currentIds[index])
  ) {
    return roomOrder;
  }

  if (nextIds.length === 0) {
    if (!(orderKey in roomOrder)) return roomOrder;
    const { [orderKey]: _removed, ...remaining } = roomOrder;
    return remaining;
  }

  return { ...roomOrder, [orderKey]: nextIds };
};

export const removeRoomFromRoomOrder = (
  roomOrder: RoomOrder,
  roomId: string,
  orderKeys: Iterable<string> = Object.keys(roomOrder)
): RoomOrder => {
  const keys = new Set(orderKeys);
  return Object.entries(roomOrder).reduce<RoomOrder>((next, [orderKey, roomIds]) => {
    const filtered = keys.has(orderKey) ? roomIds.filter((id) => id !== roomId) : roomIds;
    if (filtered.length > 0) next[orderKey] = filtered;
    return next;
  }, {});
};

export const removeRoomOrder = (roomOrder: RoomOrder, orderKey: string): RoomOrder => {
  if (!(orderKey in roomOrder)) return roomOrder;
  const { [orderKey]: _removed, ...remaining } = roomOrder;
  return remaining;
};

const roomFoldersWriteTails = new WeakMap<MatrixClient, Promise<RoomFolderNavigationState>>();

export type RoomFolderNavigationMutation = (
  state: RoomFolderNavigationState
) => RoomFolderNavigationState;

export const enqueueRoomFolderNavigationMutation = (
  mx: MatrixClient,
  mutation: RoomFolderNavigationMutation
): Promise<RoomFolderNavigationState> => {
  const task = (roomFoldersWriteTails.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = mx.getAccountData(ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any)?.getContent();
      const state = sanitizeRoomFolderNavigationState(current);
      const next = mutation(state);
      if (next === state) return state;
      await mx.setAccountData(
        ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any,
        makeRoomFoldersAccountData(current, next.folders, next.roomOrder) as any
      );

      const echoed = mx.getAccountData(ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any)?.getContent();
      // A running matrix-js-sdk client resolves setAccountData after a same-type
      // sync echo, which may contain a concurrent writer's value. Test doubles
      // and pre-start clients can resolve without updating the local store; in
      // that fallback case, preserve the successfully requested state.
      return echoed === current ? next : sanitizeRoomFolderNavigationState(echoed);
    });

  roomFoldersWriteTails.set(mx, task);
  return task;
};

/**
 * Serialize mutations from this client and apply each one to the latest
 * account-data echo. This prevents two quick local changes from overwriting
 * each other and preserves fields owned by newer clients.
 */
export const enqueueRoomFoldersMutation = (
  mx: MatrixClient,
  mutation: RoomFoldersMutation
): Promise<void> =>
  enqueueRoomFolderNavigationMutation(mx, (state) => {
    const folders = mutation(state.folders);
    return folders === state.folders ? state : { ...state, folders };
  }).then(() => undefined);
