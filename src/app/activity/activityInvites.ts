import type { MatrixClient } from 'matrix-js-sdk';
import { hasBadWords, makeInviteData } from '../notifications/inbox/Invites';
import type { ActivityInvite } from './activityRows';

/**
 * The pending invites Activity lists, with who sent each and when; invites with words of spam
 * invites stay on the invite list only.
 */
export const readActivityInvites = (mx: MatrixClient, roomIds: string[]): ActivityInvite[] =>
  roomIds.flatMap((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room) return [];
    const invite = makeInviteData(mx, room, room.isSpaceRoom());
    if (hasBadWords(invite)) return [];
    return [
      {
        roomId,
        ...(invite.senderId ? { inviterId: invite.senderId } : {}),
        ts: invite.inviteTs ?? 0,
      },
    ];
  });
