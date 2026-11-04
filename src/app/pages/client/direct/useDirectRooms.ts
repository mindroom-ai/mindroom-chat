import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { navigationRoomsAtom } from '../../../mindroom/rooms/archivedRooms';

const byLatestActivity = (a: Room, b: Room): number =>
  b.getLastActiveTimestamp() - a.getLastActiveTimestamp();

const sameOrder = (a: Room[], b: Room[]): boolean =>
  a.length === b.length && a.every((room, index) => room === b[index]);

/**
 * The joined direct rooms the user has not archived, by latest activity. A new message that
 * moves its conversation re-renders the list; messages that keep the order (a streamed reply's
 * edits in the top conversation) do not.
 */
export function useDirectRooms(): Room[] {
  const client = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directIds = useAtomValue(mDirectAtom);
  const [, resort] = useReducer((count: number) => count + 1, 0);

  const directs = useMemo(
    () =>
      roomIds.flatMap((roomId) => {
        const room = directIds.has(roomId) ? client.getRoom(roomId) : null;
        return room ? [room] : [];
      }),
    [client, roomIds, directIds]
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
