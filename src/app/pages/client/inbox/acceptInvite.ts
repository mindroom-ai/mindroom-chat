import { MatrixClient, Room } from 'matrix-js-sdk';
import { isDirectInvite } from '../../../utils/room';
import { addRoomIdToMDirect, guessDmRoomUserId, rateLimitedActions } from '../../../utils/matrix';

export const acceptInvite = async (mx: MatrixClient, room: Room): Promise<void> => {
  const userId = mx.getSafeUserId();
  // Guess the DM partner before joining, while the inviter is still the other member.
  const dmUserId = isDirectInvite(room, userId) ? guessDmRoomUserId(room, userId) : undefined;

  await mx.joinRoom(room.roomId);
  if (dmUserId) {
    await addRoomIdToMDirect(mx, room.roomId, dmUserId);
  }
};

// One failed join leaves that invite in the list and does not stop the rest.
export const acceptInvites = (mx: MatrixClient, rooms: Room[]): Promise<void> =>
  rateLimitedActions(rooms, (room) => acceptInvite(mx, room));
