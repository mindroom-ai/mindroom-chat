import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncState } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { createSyncEngine } from '../syncEngine';
import {
  getEvictionProtectedRoomIds,
  __resetEvictionForTests,
  resetCacheStoreForTesting,
} from '../../cache/db';

const makeRoom = (roomId: string): Room =>
  ({
    roomId,
    hasEncryptionStateEvent: () => false,
    getLastActiveTimestamp: () => 0,
  } as unknown as Room);

const createClient = (rooms: Map<string, Room>): MatrixClient =>
  ({
    on: () => undefined,
    removeListener: () => undefined,
    getSyncState: () => SyncState.Syncing,
    getHomeserverUrl: () => 'https://mindroom.chat',
    getSafeUserId: () => '@bob:mindroom.chat',
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    getRooms: () => Array.from(rooms.values()),
  } as unknown as MatrixClient);

describe('engine.noteRoomFocused (ISSUE-207 P4.2)', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    __resetEvictionForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    __resetEvictionForTests();
  });

  it('replaces the protection set with the currently-focused room (single-element v1)', async () => {
    const rooms = new Map<string, Room>();
    rooms.set('!a:mindroom.chat', makeRoom('!a:mindroom.chat'));
    rooms.set('!b:mindroom.chat', makeRoom('!b:mindroom.chat'));
    const mx = createClient(rooms);
    const engine = createSyncEngine({ mx });

    engine.noteRoomFocused('!a:mindroom.chat');
    expect(getEvictionProtectedRoomIds()).toEqual(['!a:mindroom.chat']);
    engine.noteRoomFocused('!b:mindroom.chat');
    expect(getEvictionProtectedRoomIds()).toEqual(['!b:mindroom.chat']);
  });
});
