import { atom, useSetAtom } from 'jotai';
import {
  ClientEvent,
  KnownMembership,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { useEffect } from 'react';
import { StateEvent } from '../types/room';
import { matchesEnum } from '../../lib/matchesEnum';

/**
 * Rooms that were upgraded into a room this account has joined. The successor stands in for them
 * in the room lists, which would otherwise show both under the same name; the old room still
 * opens by its address, where its banner leads to the new one.
 */
export const replacedRoomsAtom = atom<ReadonlySet<string>>(new Set<string>());

const successorOf = (room: Room): string | undefined => {
  const roomId: unknown = room.currentState
    .getStateEvents(StateEvent.RoomTombstone, '')
    ?.getContent().replacement_room;
  return typeof roomId === 'string' && roomId && roomId !== room.roomId ? roomId : undefined;
};

/** The rooms of `mx` whose tombstone names a room the account has joined. */
export const findReplacedRooms = (mx: MatrixClient): Set<string> => {
  const replaced = new Set<string>();
  mx.getRooms().forEach((room) => {
    const successor = successorOf(room);
    if (successor && matchesEnum(mx.getRoom(successor)?.getMyMembership(), KnownMembership.Join)) {
      replaced.add(room.roomId);
    }
  });
  return replaced;
};

const sameRooms = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((roomId) => b.has(roomId));

/** Keeps `replacedRoomsAtom` in step with the client's tombstones and memberships. */
export const useBindReplacedRoomsAtom = (mx: MatrixClient): void => {
  const setReplaced = useSetAtom(replacedRoomsAtom);
  useEffect(() => {
    let scheduled = false;
    let stopped = false;
    // A sync brings many rooms at once; they share one look at every room.
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (stopped) return;
        const next = findReplacedRooms(mx);
        setReplaced((current) => (sameRooms(current, next) ? current : next));
      });
    };
    const onState = (event: MatrixEvent) => {
      if (event.getType() === StateEvent.RoomTombstone) refresh();
    };
    refresh();
    mx.on(ClientEvent.Room, refresh);
    mx.on(ClientEvent.DeleteRoom, refresh);
    mx.on(RoomEvent.MyMembership, refresh);
    mx.on(RoomStateEvent.Events, onState);
    return () => {
      stopped = true;
      mx.removeListener(ClientEvent.Room, refresh);
      mx.removeListener(ClientEvent.DeleteRoom, refresh);
      mx.removeListener(RoomEvent.MyMembership, refresh);
      mx.removeListener(RoomStateEvent.Events, onState);
    };
  }, [mx, setReplaced]);
};
