import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';

// The offline cache keeps encrypted rooms as ciphertext, and since P2-e2ee-F011 their thread
// titles in memory only. The account's other stores follow the same rule: no text the client read
// out of an encrypted room's events goes to disk, neither the preview of a recently opened thread
// nor the quoted message of a reply draft. The person's own unsent text stays, so a reload loses
// nothing they wrote. The stores ask here which rooms are encrypted, and once the account's rooms
// are known, the text an older version stored is deleted.

/** Deletes what one of an account's stores kept from its encrypted rooms. */
export type ForgetEncryptedRoomText = (userId: string) => void;

const clients = new Map<string, MatrixClient>();

/** Whether the account `userId` knows `roomId` as an encrypted room. */
export const isEncryptedRoomOf = (userId: string, roomId: string): boolean =>
  !!clients.get(userId)?.getRoom(roomId)?.hasEncryptionStateEvent();

/**
 * Answers the stores of `mx`'s account which rooms are encrypted, and runs each `forget` once the
 * account's rooms are known; call it before the client starts. Returns a function that stops it.
 */
export const keepEncryptedRoomTextOffDisk = (
  mx: MatrixClient,
  forget: ForgetEncryptedRoomText[]
): (() => void) => {
  const userId = mx.getUserId();
  if (!userId) return () => undefined;
  clients.set(userId, mx);
  const onSync = (state: SyncState) => {
    if (state === SyncState.Prepared) forget.forEach((run) => run(userId));
  };
  mx.on(ClientEvent.Sync, onSync);
  return () => {
    mx.removeListener(ClientEvent.Sync, onSync);
    if (clients.get(userId) === mx) clients.delete(userId);
  };
};
