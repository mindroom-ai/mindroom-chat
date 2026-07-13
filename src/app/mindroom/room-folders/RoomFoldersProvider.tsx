import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ClientEvent, MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { clearLegacyRoomOrderBySpace, readLegacyRoomOrderBySpace } from '../../state/sidebarOrder';
import { randomStr } from '../../utils/common';
import {
  ROOM_FOLDERS_ACCOUNT_DATA_TYPE,
  RoomFolder,
  RoomFolderNavigationMutation,
  RoomFolderNavigationState,
  RoomOrder,
  UNFILED_ROOM_ORDER_KEY,
  addRoomFolder,
  deleteRoomFolder,
  enqueueRoomFolderNavigationMutation,
  makeFolderRoomOrderKey,
  moveRoomToFolder,
  removeRoomFromRoomOrder,
  removeRoomOrder,
  renameRoomFolder,
  sanitizeRoomFolderNavigationState,
  setRoomOrder,
  makeSpaceRoomOrderKey,
} from './roomFolders';

export type RoomOrderPlacement = {
  orderKey: string;
  roomIds: string[];
};

type RoomFoldersContextValue = {
  folders: RoomFolder[];
  roomOrder: RoomOrder;
  saveError: boolean;
  clearSaveError: () => void;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  moveRoom: (roomId: string, folderId?: string, placement?: RoomOrderPlacement) => Promise<void>;
  reorderRooms: (orderKey: string, roomIds: string[]) => Promise<void>;
  clearRoomOrder: (orderKey: string) => Promise<void>;
};

const RoomFoldersContext = createContext<RoomFoldersContextValue | undefined>(undefined);

const readRoomFolderNavigation = (
  mx: ReturnType<typeof useMatrixClient>
): RoomFolderNavigationState =>
  sanitizeRoomFolderNavigationState(
    mx.getAccountData(ROOM_FOLDERS_ACCOUNT_DATA_TYPE as any)?.getContent()
  );

export function RoomFoldersProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const [navigation, setNavigation] = useState<RoomFolderNavigationState>(() =>
    readRoomFolderNavigation(mx)
  );
  const [saveError, setSaveError] = useState(false);
  const legacyMigrationStarted = useRef(false);
  const initialSyncCompleted = useRef(hasCompletedInitialSync);
  const initialSyncWaiters = useRef(new Set<() => void>());

  useEffect(() => {
    initialSyncCompleted.current = hasCompletedInitialSync;
    if (!hasCompletedInitialSync) return;

    initialSyncWaiters.current.forEach((resolve) => resolve());
    initialSyncWaiters.current.clear();
  }, [hasCompletedInitialSync]);

  const waitForInitialSync = useCallback((): Promise<void> => {
    if (initialSyncCompleted.current) return Promise.resolve();
    return new Promise((resolve) => {
      initialSyncWaiters.current.add(resolve);
    });
  }, []);

  useEffect(() => {
    setNavigation(readRoomFolderNavigation(mx));
    setSaveError(false);

    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === ROOM_FOLDERS_ACCOUNT_DATA_TYPE) {
        setNavigation(sanitizeRoomFolderNavigationState(event.getContent()));
        setSaveError(false);
      }
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx]);

  const mutate = useCallback(
    async (mutation: RoomFolderNavigationMutation) => {
      setSaveError(false);
      setNavigation((current) => mutation(current));
      try {
        await waitForInitialSync();
        await enqueueRoomFolderNavigationMutation(mx, mutation);
      } catch (error) {
        setNavigation(readRoomFolderNavigation(mx));
        setSaveError(true);
        throw error;
      }
    },
    [mx, waitForInitialSync]
  );

  useEffect(() => {
    if (!hasCompletedInitialSync || legacyMigrationStarted.current) return;
    legacyMigrationStarted.current = true;

    const userId = mx.getUserId?.();
    if (!userId) return;

    const legacyOrder = readLegacyRoomOrderBySpace(userId);
    if (Object.keys(legacyOrder).length === 0) return;

    void mutate((current) => {
      let roomOrder = current.roomOrder;
      Object.entries(legacyOrder).forEach(([spaceId, roomIds]) => {
        const orderKey = makeSpaceRoomOrderKey(spaceId);
        if (!(orderKey in roomOrder)) roomOrder = setRoomOrder(roomOrder, orderKey, roomIds);
      });
      return roomOrder === current.roomOrder ? current : { ...current, roomOrder };
    })
      .then(() => {
        clearLegacyRoomOrderBySpace(userId);
      })
      .catch(() => undefined);
  }, [hasCompletedInitialSync, mx, mutate]);

  const createFolder = useCallback(
    (name: string) => {
      // The mutation runs once for the optimistic state and again against the
      // latest account data. Capture one ID so both applications target the
      // same folder, including any immediately queued room move.
      const folderId = randomStr();
      return mutate((current) => {
        const folders = addRoomFolder(current.folders, { id: folderId, name });
        return folders === current.folders ? current : { ...current, folders };
      });
    },
    [mutate]
  );
  const renameFolder = useCallback(
    (folderId: string, name: string) =>
      mutate((current) => {
        const folders = renameRoomFolder(current.folders, folderId, name);
        return folders === current.folders ? current : { ...current, folders };
      }),
    [mutate]
  );
  const deleteFolder = useCallback(
    (folderId: string) =>
      mutate((current) => {
        const folders = deleteRoomFolder(current.folders, folderId);
        const roomOrder = removeRoomOrder(current.roomOrder, makeFolderRoomOrderKey(folderId));
        return folders === current.folders && roomOrder === current.roomOrder
          ? current
          : { folders, roomOrder };
      }),
    [mutate]
  );
  const moveRoom = useCallback(
    (roomId: string, folderId?: string, placement?: RoomOrderPlacement) =>
      mutate((current) => {
        const currentFolderId = current.folders.find((folder) =>
          folder.roomIds.includes(roomId)
        )?.id;
        const folders = moveRoomToFolder(current.folders, roomId, folderId);
        if (folders === current.folders) return current;

        const personalOrderKeys = new Set([UNFILED_ROOM_ORDER_KEY]);
        if (currentFolderId) personalOrderKeys.add(makeFolderRoomOrderKey(currentFolderId));
        if (folderId) personalOrderKeys.add(makeFolderRoomOrderKey(folderId));
        let roomOrder = removeRoomFromRoomOrder(current.roomOrder, roomId, personalOrderKeys);
        if (placement) {
          roomOrder = setRoomOrder(roomOrder, placement.orderKey, placement.roomIds);
        }
        return { folders, roomOrder };
      }),
    [mutate]
  );
  const reorderRooms = useCallback(
    (orderKey: string, roomIds: string[]) =>
      mutate((current) => {
        const roomOrder = setRoomOrder(current.roomOrder, orderKey, roomIds);
        return roomOrder === current.roomOrder ? current : { ...current, roomOrder };
      }),
    [mutate]
  );
  const clearRoomOrder = useCallback(
    (orderKey: string) =>
      mutate((current) => {
        const roomOrder = removeRoomOrder(current.roomOrder, orderKey);
        return roomOrder === current.roomOrder ? current : { ...current, roomOrder };
      }),
    [mutate]
  );
  const clearSaveError = useCallback(() => setSaveError(false), []);
  const value = useMemo<RoomFoldersContextValue>(
    () => ({
      folders: navigation.folders,
      roomOrder: navigation.roomOrder,
      saveError,
      clearSaveError,
      createFolder,
      renameFolder,
      deleteFolder,
      moveRoom,
      reorderRooms,
      clearRoomOrder,
    }),
    [
      clearRoomOrder,
      clearSaveError,
      createFolder,
      deleteFolder,
      moveRoom,
      navigation.folders,
      navigation.roomOrder,
      renameFolder,
      reorderRooms,
      saveError,
    ]
  );

  return <RoomFoldersContext.Provider value={value}>{children}</RoomFoldersContext.Provider>;
}

export const useRoomFolders = (): RoomFoldersContextValue => {
  const value = useContext(RoomFoldersContext);
  if (!value) throw new Error('RoomFoldersProvider is missing');
  return value;
};
