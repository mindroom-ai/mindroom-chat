import { MatrixClient } from 'matrix-js-sdk';

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
  [key: string]: unknown;
};

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

export const makeRoomFoldersAccountData = (
  currentContent: unknown,
  folders: RoomFolder[]
): RoomFoldersAccountData => {
  const current = isRecord(currentContent) ? currentContent : {};
  const currentVersion =
    typeof current.version === 'number' && Number.isFinite(current.version)
      ? current.version
      : undefined;
  return {
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

const roomFoldersWriteTails = new WeakMap<MatrixClient, Promise<void>>();

/**
 * Serialize mutations from this client and apply each one to the latest
 * account-data echo. This prevents two quick local changes from overwriting
 * each other and preserves fields owned by newer clients.
 */
export const enqueueRoomFoldersMutation = (
  mx: MatrixClient,
  mutation: RoomFoldersMutation
): Promise<void> => {
  const task = (roomFoldersWriteTails.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = mx.getAccountData(ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any)?.getContent();
      const folders = mutation(sanitizeRoomFolders(current));
      await mx.setAccountData(
        ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any,
        makeRoomFoldersAccountData(current, folders) as any
      );
    });

  roomFoldersWriteTails.set(mx, task);
  return task;
};
