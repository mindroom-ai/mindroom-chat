import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { navigationRoomsAtom } from '../../matrix/state/archivedRooms';

const byLatestActivity = (a: Room, b: Room): number =>
  b.getLastActiveTimestamp() - a.getLastActiveTimestamp();

const sameOrder = (a: Room[], b: Room[]): boolean =>
  a.length === b.length && a.every((room, index) => room === b[index]);

/**
 * The IDs of the joined direct rooms the user has not archived: what Direct Messages lists, and
 * what the rail's Direct Messages button counts and marks read.
 */
export const useDirectRoomIds = (): string[] => {
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directIds = useAtomValue(mDirectAtom);
  return useMemo(() => roomIds.filter((roomId) => directIds.has(roomId)), [roomIds, directIds]);
};

/**
 * The joined direct rooms the user has not archived, by latest activity. A new message that
 * moves its conversation re-renders the list; messages that keep the order (a streamed reply's
 * edits in the top conversation) do not.
 */
export function useDirectRooms(): Room[] {
  const client = useMatrixClient();
  const directIds = useAtomValue(mDirectAtom);
  const roomIds = useDirectRoomIds();
  const [, resort] = useReducer((count: number) => count + 1, 0);

  const directs = useMemo(
    () =>
      roomIds.flatMap((roomId) => {
        const room = client.getRoom(roomId);
        return room ? [room] : [];
      }),
    [client, roomIds]
  );
  const sorted = [...directs].sort(byLatestActivity);
  const shown = useRef(sorted);
  shown.current = sorted;

  useEffect(() => {
    const onTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (
      _event,
      room,
      toStartOfTimeline,
      _removed,
      data
    ) => {
      if (!room || toStartOfTimeline || !data.liveEvent || !directIds.has(room.roomId)) return;
      const current = shown.current;
      if (!sameOrder(current, [...current].sort(byLatestActivity))) resort();
    };
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [client, directIds]);

  return sorted;
}
