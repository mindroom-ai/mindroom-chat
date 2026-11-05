import { useEffect, useReducer } from 'react';
import { useAtomValue } from 'jotai';
import {
  EventTimeline,
  EventType,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { useAutoDiscoveryInfo } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { getServerEmojiRoomAddress } from './serverEmojiConfig';
import { matchesEnum } from '../../lib/matchesEnum';

const stateEvent = (room: Room, type: string): MatrixEvent | null | undefined =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, '');

const isUsable = (room: Room): boolean =>
  matchesEnum(room.getMyMembership(), KnownMembership.Join) &&
  !stateEvent(room, EventType.RoomTombstone);

// Any server can put any canonical alias on a room it creates; the homeserver's own emoji room
// is created local-only, so only such a room can be the one an alias names.
const isLocalOnly = (room: Room): boolean =>
  stateEvent(room, EventType.RoomCreate)?.getContent()['m.federate'] === false;

/**
 * The joined, current (not tombstoned) room an address names: the room with that ID, or the
 * local-only room whose canonical alias it is.
 */
export const findServerEmojiRoom = (
  mx: MatrixClient,
  address: string | undefined
): Room | undefined => {
  if (!address) return undefined;
  if (address.startsWith('!')) {
    const room = mx.getRoom(address);
    return room && isUsable(room) ? room : undefined;
  }
  return mx
    .getRooms()
    .find((room) => room.getCanonicalAlias() === address && isUsable(room) && isLocalOnly(room));
};

// Not membership: the user's own joins and leaves come through the room list, and everyone
// else's member events, thousands during a first sync with lazy-loaded members, change nothing.
const WATCHED_STATE = new Set<string>([
  EventType.RoomTombstone,
  EventType.RoomCanonicalAlias,
  EventType.RoomCreate,
]);

/**
 * The homeserver's emoji room, when the user is in it. Follows the room list and the state that
 * decides which room an address names, so a join or an upgrade shows at once.
 */
export const useServerEmojiRoom = (): Room | undefined => {
  const mx = useMatrixClient();
  const address = getServerEmojiRoomAddress(useAutoDiscoveryInfo());
  // Joins and leaves arrive through the room list.
  useAtomValue(allRoomsAtom);
  const [, refresh] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const handleState = (event: MatrixEvent) => {
      if (WATCHED_STATE.has(event.getType())) refresh();
    };
    mx.on(RoomStateEvent.Events, handleState);
    return () => {
      mx.removeListener(RoomStateEvent.Events, handleState);
    };
  }, [mx]);

  return findServerEmojiRoom(mx, address);
};
