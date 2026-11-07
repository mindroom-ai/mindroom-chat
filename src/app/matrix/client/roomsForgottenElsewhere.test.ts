import { EventEmitter } from 'events';
import { ClientEvent, KnownMembership, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { dropRoomsForgottenElsewhere } from './roomsForgottenElsewhere';

type FakeRoom = { roomId: string; membership: string };

/** A client with rooms, a server that answers `/joined_rooms`, and a saved sync. */
const makeClient = (rooms: FakeRoom[], joinedOnServer: () => string[]) => {
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
  const mx = Object.assign(emitter, {
    store,
    getJoinedRooms,
    getRooms: () =>
      rooms.map((room) => ({ roomId: room.roomId, getMyMembership: () => room.membership })),
  }) as unknown as MatrixClient;
  const deleted: string[] = [];
  emitter.on(ClientEvent.DeleteRoom, (roomId: string) => deleted.push(roomId));
  return { mx, emitter, store, accumulateRooms, getJoinedRooms, deleted };
};

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

    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
    await settle();
    expect(client.getJoinedRooms).toHaveBeenCalledTimes(1);
    // The room stays until two more batches from the server have not brought its leave.
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    await settle();
    expect(client.deleted).toEqual([]);
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    await settle();
    expect(client.deleted).toEqual(['!forgotten:example.org']);
    expect(client.accumulateRooms).toHaveBeenCalledWith({
      rooms: { leave: { '!forgotten:example.org': {} } },
    });
    expect(client.store.save).toHaveBeenCalledWith(true);
    expect(client.store.save).toHaveBeenCalledTimes(2);
    expect(rooms.map((room) => room.roomId)).toEqual(['!kept:example.org', '!invite:example.org']);

    // Once per start.
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    await settle();
    expect(client.getJoinedRooms).toHaveBeenCalledTimes(1);
  });

  it('keeps a room left on another device while the server was asked, which sync then brings as left', async () => {
    const rooms: FakeRoom[] = [
      { roomId: '!kept:example.org', membership: KnownMembership.Join },
      { roomId: '!left:example.org', membership: KnownMembership.Join },
    ];
    // Left elsewhere just before the server answered: the answer no longer lists it, and its
    // leave reaches this client only with a later batch.
    const client = makeClient(rooms, () => ['!kept:example.org']);
    dropRoomsForgottenElsewhere(client.mx);
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
    await settle();
    expect(client.getJoinedRooms).toHaveBeenCalledTimes(1);

    // A batch that the server put together before the leave.
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    await settle();
    // The next one brings the leave: the SDK keeps the room, with its state, as left.
    rooms[1]!.membership = KnownMembership.Leave;
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    await settle();
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
    for (let batch = 0; batch < 3; batch += 1) {
      client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
      // eslint-disable-next-line no-await-in-loop
      await settle();
    }
    expect(client.deleted).toEqual([]);
    expect(client.accumulateRooms).not.toHaveBeenCalled();
    expect(client.store.save).not.toHaveBeenCalled();
  });
});
