import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { createRoomListAtom, useBindRoomListAtom, type RoomListAtom } from './utils';
import { matchesEnum } from '../../utils/matchesEnum';

/** IDs of every room and space the user is invited to. */
export const allInvitesAtom: RoomListAtom = createRoomListAtom();

const isInvited = (room: Room): boolean =>
  matchesEnum(room.getMyMembership(), KnownMembership.Invite);

export const useBindAllInvitesAtom = (
  mx: MatrixClient,
  invitesAtom: RoomListAtom = allInvitesAtom
) => useBindRoomListAtom(mx, invitesAtom, isInvited);
