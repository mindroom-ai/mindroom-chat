import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { createRoomListAtom, useBindRoomListAtom, type RoomListAtom } from './utils';
import { matchesEnum } from '../../lib/matchesEnum';

/** IDs of every room the user has joined, spaces included. */
export const allRoomsAtom: RoomListAtom = createRoomListAtom();

export const isJoined = (room: Room): boolean =>
  matchesEnum(room.getMyMembership(), KnownMembership.Join);

export const useBindAllRoomsAtom = (mx: MatrixClient, roomsAtom: RoomListAtom = allRoomsAtom) =>
  useBindRoomListAtom(mx, roomsAtom, isJoined);
