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

  it('keeps a room joined while the server was asked, and does nothing when all are listed', async () => {
    const rooms: FakeRoom[] = [{ roomId: '!kept:example.org', membership: KnownMembership.Join }];
    const client = makeClient(rooms, () => {
      // Joined meanwhile: the answer does not know it yet.
      rooms.push({ roomId: '!new:example.org', membership: KnownMembership.Join });
      return ['!kept:example.org'];
    });
    dropRoomsForgottenElsewhere(client.mx);
    client.emitter.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
    await settle();
    expect(client.deleted).toEqual([]);
    expect(client.accumulateRooms).not.toHaveBeenCalled();
    expect(client.store.save).not.toHaveBeenCalled();
  });
});
