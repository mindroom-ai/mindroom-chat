// Which rooms take sub-rooms and which chat rooms a room is a sub-room of, as the room menu's New
// Sub-room and Remove from answer them, for the menu and for client plugins (`@mindroom/client-sdk/room`).
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { getImperativeJotaiStore } from '../../lib/state/jotaiStore';
import type { RoomToParents } from '../types/room';
import { mDirectAtom } from './mDirectList';
import { roomToParentsAtom } from './roomToParents';

/**
 * Whether New Sub-room is offered in `room`, a chat room: a space lists its rooms in its lobby
 * instead, and the partner of a direct chat (one of `directRooms`) would find no list to join its
 * sub-rooms from.
 */
const takesSubRooms = (room: Room, directRooms: ReadonlySet<string>): boolean =>
  !room.isSpaceRoom() && !directRooms.has(room.roomId);

/** Whether the room menu offers New Sub-room in `room`, rendered again when the direct chats change. */
export const useOffersSubRooms = (room: Room): boolean =>
  takesSubRooms(room, useAtomValue(mDirectAtom));

/**
 * Whether the room menu offers New Sub-room in `room`: a chat room, neither a space nor a direct
 * chat, read once.
 */
export const offersSubRooms = (room: Room): boolean =>
  takesSubRooms(room, getImperativeJotaiStore().get(mDirectAtom));

/** The chat rooms `room`'s client has that list `room` as a sub-room in `roomToParents`. */
const chatRoomParents = (room: Room, roomToParents: RoomToParents): Room[] =>
  [...(roomToParents.get(room.roomId) ?? [])]
    .flatMap((roomId) => room.client.getRoom(roomId) ?? [])
    .filter((parent) => !parent.isSpaceRoom());

/**
 * The chat rooms the client has that list `room` as a sub-room, spaces left out: the rooms its
 * menu's Remove from takes it off. It renders again when a link to `room` changes.
 */
export const useParentRooms = (room: Room): Room[] => {
  const roomToParents = useAtomValue(roomToParentsAtom);
  return useMemo(() => chatRoomParents(room, roomToParents), [room, roomToParents]);
};

/** `useParentRooms(room)`, read once. */
export const getParentRooms = (room: Room): Room[] =>
  chatRoomParents(room, getImperativeJotaiStore().get(roomToParentsAtom));
