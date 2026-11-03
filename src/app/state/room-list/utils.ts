import { useEffect } from 'react';
import { atom, type WritableAtom, useSetAtom } from 'jotai';
import { ClientEvent, type MatrixClient, type Room, RoomEvent } from 'matrix-js-sdk';

export type RoomsAction =
  | { type: 'INITIALIZE'; rooms: string[] }
  | { type: 'PUT'; roomId: string }
  | { type: 'DELETE'; roomId: string };

export type RoomListAtom = WritableAtom<string[], [RoomsAction], void>;

/** A list of room IDs; `PUT` appends a room that is not listed yet. */
export const createRoomListAtom = (): RoomListAtom => {
  const roomsAtom = atom<string[]>([]);
  return atom<string[], [RoomsAction], void>(
    (get) => get(roomsAtom),
    (get, set, action) => {
      const rooms = get(roomsAtom);
      if (action.type === 'INITIALIZE') {
        set(roomsAtom, Array.from(new Set(action.rooms)));
        return;
      }
      const listed = rooms.includes(action.roomId);
      if (action.type === 'PUT') {
        if (!listed) set(roomsAtom, [...rooms, action.roomId]);
        return;
      }
      if (listed)
        set(
          roomsAtom,
          rooms.filter((roomId) => roomId !== action.roomId)
        );
    }
  );
};

/** Keeps a room list in step with the client's rooms that match `belongs`. */
export const useBindRoomListAtom = (
  mx: MatrixClient,
  roomListAtom: RoomListAtom,
  belongs: (room: Room) => boolean
): void => {
  const setRooms = useSetAtom(roomListAtom);

  useEffect(() => {
    const initialRoomIds = mx
      .getRooms()
      .filter(belongs)
      .map((room) => room.roomId);
    setRooms({ type: 'INITIALIZE', rooms: initialRoomIds });

    const update = (room: Room) => {
      setRooms(
        belongs(room)
          ? { type: 'PUT', roomId: room.roomId }
          : { type: 'DELETE', roomId: room.roomId }
      );
    };
    const handleDeleteRoom = (roomId: string) => setRooms({ type: 'DELETE', roomId });

    mx.on(ClientEvent.Room, update);
    mx.on(RoomEvent.MyMembership, update);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    return () => {
      mx.removeListener(ClientEvent.Room, update);
      mx.removeListener(RoomEvent.MyMembership, update);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
    };
  }, [mx, setRooms, belongs]);
};
