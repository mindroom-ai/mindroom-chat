import {
  ClientEvent,
  KnownMembership,
  Method,
  SyncState,
  type MatrixClient,
  type SyncStateData,
} from 'matrix-js-sdk';
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
// room with no state ("Empty room"). So the rooms the answer misses are looked up in sync itself:
// one /sync from the batch the question followed, answered at once and limited to those rooms,
// carries the leave of every room left since, and never that of a forgotten one. Waiting for the
// SDK's own next batches instead kept a forgotten room in the list for up to a minute, as an idle
// account gets a batch only when the 30 second long poll ends.

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

const NOTHING = { not_types: ['*'] };

/** The rooms of `roomIds` that sync from the batch `since` brings as left, answered at once. */
const roomsLeftSince = async (
  mx: MatrixClient,
  since: string,
  roomIds: string[]
): Promise<Set<string>> => {
  // The leave is the room's last timeline event; nothing else is needed.
  const filter = {
    presence: NOTHING,
    account_data: NOTHING,
    room: {
      rooms: roomIds,
      timeline: { limit: 1 },
      state: NOTHING,
      ephemeral: NOTHING,
      account_data: NOTHING,
    },
  };
  const response = await mx.http.authedRequest<{ rooms?: { leave?: Record<string, unknown> } }>(
    Method.Get,
    '/sync',
    { since, timeout: '0', filter: JSON.stringify(filter) }
  );
  return new Set(Object.keys(response.rooms?.leave ?? {}));
};

/** Removes rooms that `/joined_rooms` no longer lists; call it before the client starts. */
export const dropRoomsForgottenElsewhere = (mx: MatrixClient): void => {
  // `asked`: the rooms joined as of the batch `since`; one joined later is not in an older answer.
  const reconcile = async (asked: string[], since: string) => {
    const { joined_rooms: listed } = await mx.getJoinedRooms();
    const missing = asked.filter((roomId) => !listed.includes(roomId));
    if (missing.length === 0) return;
    const left = await roomsLeftSince(mx, since, missing);
    // A room this device left or forgot meanwhile is no longer joined here.
    const stillJoined = new Set(joinedRoomIds(mx));
    const gone = missing.filter((roomId) => !left.has(roomId) && stillJoined.has(roomId));
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

  // The SDK reports SYNCING once it has processed a batch from the server, with that batch's
  // token; the saved sync replayed at start is reported as PREPARED only.
  const onSync = (state: SyncState | null, _previous: SyncState | null, data?: SyncStateData) => {
    if (state !== SyncState.Syncing) return;
    mx.removeListener(ClientEvent.Sync, onSync);
    const since = data?.nextSyncToken;
    if (!since) return;
    reconcile(joinedRoomIds(mx), since).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[roomsForgottenElsewhere] could not compare the joined rooms', error);
    });
  };
  mx.on(ClientEvent.Sync, onSync);
};
