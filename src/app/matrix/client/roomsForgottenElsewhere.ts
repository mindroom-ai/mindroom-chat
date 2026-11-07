import { ClientEvent, KnownMembership, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';

// A room left and forgotten on another device in one go never arrives here as left: the
// homeserver leaves forgotten rooms out of /sync, so the room stayed joined in this client and in
// its saved sync for good, and every start asked the server for its threads (403). After the
// session's first sync from the server, this asks which rooms the account is in, once, and drops
// the rooms the server no longer lists: from the client (`ClientEvent.DeleteRoom`, as forgetting
// a room does) and from the saved sync, so the next start does not bring them back.
//
// A room left on another device while the question is out is missing from the answer too, but
// its leave is still on the way through sync. Dropping it then made sync bring it back as a new
// room with no state ("Empty room"), so the drop waits for two more batches from the server: the
// second one's request went out after the answer, so it carries any leave the answer reflects.

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
    .filter((room) => matchesEnum(room.getMyMembership(), KnownMembership.Join))
    .map((room) => room.roomId);

/** Batches from the server to wait for after the answer before a room counts as forgotten. */
const SETTLING_BATCHES = 2;

/** Resolves once the SDK has processed `count` more batches from the server. */
const nextBatches = (mx: MatrixClient, count: number): Promise<void> =>
  new Promise((resolve) => {
    let left = count;
    const onSync = (state: SyncState | null) => {
      if (state !== SyncState.Syncing) return;
      left -= 1;
      if (left > 0) return;
      mx.removeListener(ClientEvent.Sync, onSync);
      resolve();
    };
    mx.on(ClientEvent.Sync, onSync);
  });

/** Removes rooms that `/joined_rooms` no longer lists; call it before the client starts. */
export const dropRoomsForgottenElsewhere = (mx: MatrixClient): void => {
  const reconcile = async () => {
    // Only rooms joined before the question: a room joined since is not in an older answer.
    const asked = joinedRoomIds(mx);
    const { joined_rooms: listed } = await mx.getJoinedRooms();
    if (asked.every((roomId) => listed.includes(roomId))) return;
    // A room left meanwhile arrives as left with these batches and is no longer joined here.
    await nextBatches(mx, SETTLING_BATCHES);
    const stillJoined = new Set(joinedRoomIds(mx));
    const gone = asked.filter((roomId) => !listed.includes(roomId) && stillJoined.has(roomId));
    if (gone.length === 0) return;
    const leave = Object.fromEntries(gone.map((roomId) => [roomId, {}]));
    (mx.store as SavedSyncStore).backend?.syncAccumulator?.accumulateRooms?.({ rooms: { leave } });
    gone.forEach((roomId) => {
      mx.store.removeRoom(roomId);
      mx.emit(ClientEvent.DeleteRoom, roomId);
    });
    // A save asked for while another one writes returns that one, which read the saved sync
    // before the change (the SDK saves after the session's first sync too); the second save
    // then writes it.
    await mx.store.save(true);
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
