import { MatrixClient, Room } from 'matrix-js-sdk';
import { isDirectInvite } from '../../../utils/room';
import { addRoomIdToMDirect, guessDmRoomUserId, rateLimitedActions } from '../../../utils/matrix';
import { Membership } from '../../../../types/matrix/room';

export const acceptInvite = async (mx: MatrixClient, room: Room): Promise<void> => {








};

// One failed join leaves that invite in the list and does not stop the rest.
export const acceptInvites = (mx: MatrixClient, rooms: Room[]): Promise<void> =>
  rateLimitedActions(rooms, async (room) => {
    // Skip invites accepted or declined since the batch started (card buttons, other devices).
    if (room.getMyMembership() !== Membership.Invite) return;
    await acceptInvite(mx, room);
  });
