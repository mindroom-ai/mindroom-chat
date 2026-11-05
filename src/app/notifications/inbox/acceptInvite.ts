import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership } from '../../matrix/types/room';
import { matchesEnum } from '../../lib/matchesEnum';
import { addRoomIdToMDirect, guessDmRoomUserId, rateLimitedActions } from '../../matrix/matrix';
import { isDirectInvite } from '../../matrix/room';

/**
 * Who a direct-chat invite is with: undefined when the invite is not marked `is_direct`, or when
 * nobody fits. Call it before joining, because the join replaces our member event and the flag is
 * gone afterwards.
 */
const personOfDirectInvite = (mx: MatrixClient, room: Room): string | undefined => {
  const me = mx.getSafeUserId();
  return isDirectInvite(room, me) ? guessDmRoomUserId(room, me) : undefined;
};

/**
 * Accepts one invite (a card's Accept button): joins the room, then files a direct chat under its
 * person in `m.direct`, which puts it under Direct Messages. Rejects when the join fails, leaving
 * `m.direct` as it was, and when the `m.direct` write fails after a successful join.
 */
export const acceptInvite = async (mx: MatrixClient, room: Room): Promise<void> => {
  const person = personOfDirectInvite(mx, room);
  await mx.joinRoom(room.roomId);
  if (person !== undefined) await addRoomIdToMDirect(mx, room.roomId, person);
};

/**
 * Accept All: accepts the invites one at a time, in the given order. An invite the reader accepted
 * or declined in the meantime (on a card, or on another device) is left alone. A failure leaves its
 * invite pending and the next one goes ahead; a rate-limited request waits for the delay the server
 * asks and runs again (`rateLimitedActions`). Resolves once every room had its turn, never rejects.
 */
export const acceptInvites = (mx: MatrixClient, rooms: Room[]): Promise<void> =>
  rateLimitedActions(rooms, async (room) => {
    if (!matchesEnum(room.getMyMembership(), Membership.Invite)) return;
    const person = personOfDirectInvite(mx, room);
    await mx.joinRoom(room.roomId);
    if (person === undefined) return;
    // Retrying this whole room after a rate-limited write would find it joined and skip it, so
    // the write retries on its own, for the person read before the join.
    await rateLimitedActions([person], (userId) => addRoomIdToMDirect(mx, room.roomId, userId));
  });
