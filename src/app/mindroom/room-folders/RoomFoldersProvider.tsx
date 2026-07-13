import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ClientEvent, MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { randomStr } from '../../utils/common';
import {
  ROOM_FOLDERS_ACCOUNT_DATA_TYPE,
  RoomFolder,
  RoomFoldersMutation,
  addRoomFolder,
  deleteRoomFolder,
  enqueueRoomFoldersMutation,
  moveRoomToFolder,
  renameRoomFolder,
  sanitizeRoomFolders,
} from './roomFolders';

type RoomFoldersContextValue = {
  folders: RoomFolder[];
  saveError: boolean;
  clearSaveError: () => void;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  moveRoom: (roomId: string, folderId?: string) => Promise<void>;
};

const RoomFoldersContext = createContext<RoomFoldersContextValue | undefined>(undefined);

const readRoomFolders = (mx: ReturnType<typeof useMatrixClient>): RoomFolder[] =>
  sanitizeRoomFolders(mx.getAccountData(ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any)?.getContent());

export function RoomFoldersProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const [folders, setFolders] = useState<RoomFolder[]>(() => readRoomFolders(mx));
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setFolders(readRoomFolders(mx));
    setSaveError(false);

    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === ROOM_FOLDERS_ACCOUNT_DATA_TYPE) {
        setFolders(sanitizeRoomFolders(event.getContent()));
        setSaveError(false);
      }
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx]);

  const mutate = useCallback(
    async (mutation: RoomFoldersMutation) => {
      setSaveError(false);
      setFolders((current) => mutation(current));
      try {
        await enqueueRoomFoldersMutation(mx, mutation);
      } catch (error) {
        setFolders(readRoomFolders(mx));
        setSaveError(true);
        throw error;
      }
    },
    [mx]
  );

  const createFolder = useCallback(
    (name: string) => {
      // The mutation runs once for the optimistic state and again against the
      // latest account data. Capture one ID so both applications target the
      // same folder, including any immediately queued room move.
      const folderId = randomStr();
      return mutate((current) => addRoomFolder(current, { id: folderId, name }));
    },
    [mutate]
  );
  const renameFolder = useCallback(
    (folderId: string, name: string) =>
      mutate((current) => renameRoomFolder(current, folderId, name)),
    [mutate]
  );
  const removeFolder = useCallback(
    (folderId: string) => mutate((current) => deleteRoomFolder(current, folderId)),
    [mutate]
  );
  const moveRoom = useCallback(
    (roomId: string, folderId?: string) =>
      mutate((current) => moveRoomToFolder(current, roomId, folderId)),
    [mutate]
  );
  const clearSaveError = useCallback(() => setSaveError(false), []);
  const value = useMemo<RoomFoldersContextValue>(
    () => ({
      folders,
      saveError,
      clearSaveError,
      createFolder,
      renameFolder,
      deleteFolder: removeFolder,
      moveRoom,
    }),
    [clearSaveError, createFolder, folders, moveRoom, removeFolder, renameFolder, saveError]
  );

  return <RoomFoldersContext.Provider value={value}>{children}</RoomFoldersContext.Provider>;
}

export const useRoomFolders = (): RoomFoldersContextValue => {
  const value = useContext(RoomFoldersContext);
  if (!value) throw new Error('RoomFoldersProvider is missing');
  return value;
};
