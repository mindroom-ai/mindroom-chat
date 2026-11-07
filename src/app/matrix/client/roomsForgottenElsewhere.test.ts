import { EventEmitter } from 'events';
import { ClientEvent, KnownMembership, Method, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { dropRoomsForgottenElsewhere } from './roomsForgottenElsewhere';

type FakeRoom = { roomId: string; membership: string };

/**
 * A client with rooms, a server that answers `/joined_rooms` and a `/sync` that brings the rooms
 * of `leftOnServer` as left, and a saved sync.
 */
const makeClient = (
  rooms: FakeRoom[],
  joinedOnServer: () => string[],
  leftOnServer: string[] = []
) => {
  const accumulateRooms = vi.fn();
  const store = {
    removeRoom: vi.fn((roomId: string) => {
      const index = rooms.findIndex((room) => room.roomId === roomId);
      if (index >= 0) rooms.splice(index, 1);
    }),
    save: vi.fn(() => Promise.resolve()),
    backend: { syncAccumulator: { accumulateRooms } },
  };
  const emitter = new EventEmitter();
  const getJoinedRooms = vi.fn(() => Promise.resolve({ joined_rooms: joinedOnServer() }));
  const authedRequest = vi.fn(() =>
    Promise.resolve({ rooms: { leave: Object.fromEntries(leftOnServer.map((id) => [id, {}])) } })
  );
  const mx = Object.assign(emitter, {
    store,
    getJoinedRooms,
    http: { authedRequest },
    getRooms: () =>
      rooms.map((room) => ({ roomId: room.roomId, getMyMembership: () => room.membership })),
  }) as unknown as MatrixClient;
  const deleted: string[] = [];
  emitter.on(ClientEvent.DeleteRoom, (roomId: string) => deleted.push(roomId));
  return { mx, emitter, store, accumulateRooms, getJoinedRooms, authedRequest, deleted };
};

/** The SDK's report of a processed batch from the server, with its token. */
const batch = (token: string) => ({ nextSyncToken: token });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('dropRoomsForgottenElsewhere', () => {
  it('drops a joined room the server no longer lists, from the client and the saved sync', async () => {
    const rooms = [
      { roomId: '!kept:example.org', membership: KnownMembership.Join },
      { roomId: '!forgotten:example.org', membership: KnownMembership.Join },
      { roomId: '!invite:example.org', membership: KnownMembership.Invite },
    ];
    const client = makeClient(rooms, () => ['!kept:example.org']);
    dropRoomsForgottenElsewhere(client.mx);

    // The saved sync replayed at start is not the server's answer yet.
    client.emitter.emit(ClientEvent.Sync, SyncState.Prepared, null);
    await settle();
    expect(client.getJoinedRooms).not.toHaveBeenCalled();

    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared, batch('s1'));
    await settle();
    expect(client.getJoinedRooms).toHaveBeenCalledTimes(1);
    // Sync from that batch, answered at once, has no leave for it: the room goes without waiting
    // for more batches, which an idle account gets only every 30 seconds.
    expect(client.authedRequest).toHaveBeenCalledTimes(1);
    expect(client.authedRequest).toHaveBeenCalledWith(Method.Get, '/sync', {
      since: 's1',
      timeout: '0',
      filter: expect.any(String),
    });
    const [, , query] = client.authedRequest.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { filter: string }
    ];
    expect(JSON.parse(query.filter)).toMatchObject({ room: { rooms: ['!forgotten:example.org'] } });
    expect(client.deleted).toEqual(['!forgotten:example.org']);
    expect(client.accumulateRooms).toHaveBeenCalledWith({
      rooms: { leave: { '!forgotten:example.org': {} } },
    });
    expect(client.store.save).toHaveBeenCalledWith(true);
    expect(client.store.save).toHaveBeenCalledTimes(2);
    expect(rooms.map((room) => room.roomId)).toEqual(['!kept:example.org', '!invite:example.org']);

    // Once per start.
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing, batch('s2'));
    await settle();
    expect(client.getJoinedRooms).toHaveBeenCalledTimes(1);
    expect(client.authedRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps a room left on another device while the server was asked, which sync then brings as left', async () => {
    const rooms: FakeRoom[] = [
      { roomId: '!kept:example.org', membership: KnownMembership.Join },
      { roomId: '!left:example.org', membership: KnownMembership.Join },
    ];
    // Left elsewhere just before the server answered: the answer no longer lists it, and its
    // leave reaches the SDK only with a later batch, but sync from the last batch has it.
    const client = makeClient(rooms, () => ['!kept:example.org'], ['!left:example.org']);
    dropRoomsForgottenElsewhere(client.mx);
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared, batch('s1'));
    await settle();
    expect(client.getJoinedRooms).toHaveBeenCalledTimes(1);
    expect(client.authedRequest).toHaveBeenCalledTimes(1);
    // The SDK keeps the room, with its state, and its own sync brings it as left.
    expect(client.deleted).toEqual([]);
    expect(client.accumulateRooms).not.toHaveBeenCalled();
    expect(client.store.removeRoom).not.toHaveBeenCalled();
    expect(rooms.map((room) => room.roomId)).toEqual(['!kept:example.org', '!left:example.org']);
  });

  it('keeps a room joined while the server was asked, and does nothing when all are listed', async () => {
    const rooms: FakeRoom[] = [{ roomId: '!kept:example.org', membership: KnownMembership.Join }];
    const client = makeClient(rooms, () => {
      // Joined meanwhile: the answer does not know it yet.
      rooms.push({ roomId: '!new:example.org', membership: KnownMembership.Join });
      return ['!kept:example.org'];
    });
    dropRoomsForgottenElsewhere(client.mx);
    for (let count = 0; count < 3; count += 1) {
      client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared, batch('s1'));
      // eslint-disable-next-line no-await-in-loop
      await settle();
    }
    expect(client.deleted).toEqual([]);
    expect(client.accumulateRooms).not.toHaveBeenCalled();
    expect(client.store.save).not.toHaveBeenCalled();
    expect(client.authedRequest).not.toHaveBeenCalled();
  });
});
