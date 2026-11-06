import { ClientEvent, KnownMembership, SyncState, type MatrixClient } from 'matrix-js-sdk';

// A room left and forgotten on another device in one go never arrives here as left: the
// homeserver leaves forgotten rooms out of /sync, so the room stayed joined in this client and in
// its saved sync for good, and every start asked the server for its threads (403). After the
// session's first sync from the server, this asks which rooms the account is in, once, and drops
// the rooms the server no longer lists: from the client (`ClientEvent.DeleteRoom`, as forgetting
// a room does) and from the saved sync, so the next start does not bring them back.

/** The part of the SDK's IndexedDB store that keeps the saved sync. */
type SavedSyncStore = {
  backend?: {
    syncAccumulator?: {
      accumulateRooms?: (sync: { rooms: { leave: Record<string, object> } }) => void;
    };
  };
};

const joinedRoomIds = (mx: MatrixClient): string[] =>
  mx
    .getRooms()
    .filter((room) => room.getMyMembership() === KnownMembership.Join)
    .map((room) => room.roomId);

/** Removes rooms that `/joined_rooms` no longer lists; call it before the client starts. */
export const dropRoomsForgottenElsewhere = (mx: MatrixClient): void => {
  const reconcile = async () => {
    // Only rooms joined before the question: a room joined since is not in an older answer.
    const asked = joinedRoomIds(mx);
    const { joined_rooms: listed } = await mx.getJoinedRooms();
    const stillJoined = new Set(joinedRoomIds(mx));
    const gone = asked.filter((roomId) => !listed.includes(roomId) && stillJoined.has(roomId));
    if (gone.length === 0) return;
    const leave = Object.fromEntries(gone.map((roomId) => [roomId, {}]));
    (mx.store as SavedSyncStore).backend?.syncAccumulator?.accumulateRooms?.({ rooms: { leave } });
    gone.forEach((roomId) => {
      mx.store.removeRoom(roomId);
      mx.emit(ClientEvent.DeleteRoom, roomId);
    });
    await mx.store.save(true);
  };

  // The SDK reports SYNCING once it has processed a batch from the server; the saved sync
  // replayed at start is reported as PREPARED only.
  const onSync = (state: SyncState | null) => {
    if (state !== SyncState.Syncing) return;
    mx.removeListener(ClientEvent.Sync, onSync);
    reconcile().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[roomsForgottenElsewhere] could not compare the joined rooms', error);
    });
  };
  mx.on(ClientEvent.Sync, onSync);
};
