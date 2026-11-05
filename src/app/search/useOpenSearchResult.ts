import { useCallback } from 'react';
import { type MatrixClient, THREAD_RELATION_TYPE } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import type { SearchResultOpenTarget } from './searchResultOpenTarget';

/**
 * The thread a hit belongs to when the hit itself does not say: a search hit on an edit names
 * only the edited message, whose own relation tells whether it is a thread reply.
 */
const findThreadRoot = async (
  client: MatrixClient,
  roomId: string,
  eventId: string
): Promise<string | undefined> => {
  const loaded = client.getRoom(roomId)?.findEventById(eventId);
  const relation = loaded
    ? loaded.getWireContent()['m.relates_to']
    : (await client.fetchRoomEvent(roomId, eventId)).content?.['m.relates_to'];
  return relation?.rel_type === THREAD_RELATION_TYPE.name && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/** Opens a search hit at its message: in its thread when it has one, else in its room. */
export const useOpenSearchResult = () => {
  const client = useMatrixClient();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();

  return useCallback(
    async (roomId: string, target: SearchResultOpenTarget) => {
      if (target.threadRootId) {
        navigateRoomThread(roomId, target.threadRootId, target.mainEventId);
        return;
      }
      const threadRootId = await findThreadRoot(client, roomId, target.mainEventId).catch(
        () => undefined
      );
      if (threadRootId) navigateRoomThread(roomId, threadRootId, target.mainEventId);
      else navigateRoom(roomId, target.mainEventId);
    },
    [client, navigateRoom, navigateRoomThread]
  );
};
