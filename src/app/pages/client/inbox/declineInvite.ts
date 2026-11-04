import type { MatrixClient } from 'matrix-js-sdk';

/**
 * Turns down an invite: leaves the room, then forgets it. Forgetting drops the room from this
 * client at once (`ClientEvent.DeleteRoom`), so the invite disappears even when a sync never
 * reports the leave, which happens for invites that carry no timeline. A declined room keeps no
 * history worth remembering, and a new invite brings it back.
 */
export const declineInvite = async (client: MatrixClient, roomId: string): Promise<void> => {
  await client.leave(roomId);
  await client.forget(roomId).catch(() => undefined);
};
