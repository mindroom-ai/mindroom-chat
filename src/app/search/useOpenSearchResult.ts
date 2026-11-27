import { useCallback } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { fetchSearchHitThread, type SearchResultOpenTarget } from './searchResultOpenTarget';

/** Opens a search hit at its message: in its thread when it has one, else in its room. */
export const useOpenSearchResult = () => {
  const client = useMatrixClient();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();

  return useCallback(
    async (roomId: string, target: SearchResultOpenTarget) => {
      const { mainEventId: id } = target;
      const resolved = target.threadRootId
        ? target
        : await fetchSearchHitThread(client, roomId, id).catch(() => null);
      if (resolved?.threadRootId) {
        navigateRoomThread(roomId, resolved.threadRootId, resolved.threadTitle ? undefined : id);
      } else navigateRoom(roomId, id);
    },
    [client, navigateRoom, navigateRoomThread]
  );
};
