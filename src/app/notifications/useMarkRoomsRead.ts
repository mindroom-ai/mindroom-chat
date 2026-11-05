import { useCallback } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

/**
 * A function that reads the given rooms and all their threads, in the order listed, and settles
 * once every receipt has been sent. Users who hide their read activity send private receipts.
 */
export const useMarkRoomsRead = (): ((roomIds: readonly string[]) => Promise<void>) => {
  const client = useMatrixClient();
  const [privateReceipts] = useSetting(settingsAtom, 'hideActivity');

  return useCallback(
    async (roomIds) => {
      await Promise.all(
        roomIds.map((roomId) => markRoomAndThreadsAsRead(client, roomId, privateReceipts))
      );
    },
    [client, privateReceipts]
  );
};
