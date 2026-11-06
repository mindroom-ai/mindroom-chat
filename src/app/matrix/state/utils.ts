import { useEffect } from 'react';
import { atom, type WritableAtom, useSetAtom } from 'jotai';
import { ClientEvent, type MatrixClient, type Room, RoomEvent } from 'matrix-js-sdk';

type RoomsAction =
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
      if (!belongs(room)) {
        setRooms({ type: 'DELETE', roomId: room.roomId });
        return;
      }
      // A sync works out the membership of a new room before it stores the room, and can wait
      // for the server in between; listed then, the room showed as an empty row that the stored
      // room never filled. It is listed once the client has it (`ClientEvent.Room`).
      if (!mx.getRoom(room.roomId)) return;
      setRooms({ type: 'PUT', roomId: room.roomId });
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
