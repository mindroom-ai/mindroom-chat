import { EventEmitter } from 'node:events';
import { createStore, Provider } from 'jotai';
import { memo, useState } from 'react';
import { RoomMemberEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { mDirectAtom } from '../../state/mDirectList';
import { createSessionId } from '../../state/sessions';
import { getRoomViewModeStorageKey, type RoomViewMode } from '../threads/roomViewMode';
import { useRoomViewMode } from '../threads/useRoomViewMode';

// A sidebar THREADS list: every entry asks useRoomViewMode for its room, as ThreadNavItem does.
const ROOMS = 10;
const ENTRIES = 300;
const MEMBERS = 300;
const ME = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const SESSION = createSessionId('https://example.org', ME);

type Member = { roomId: string; userId: string; membership: string };

// Room ids are new in every test: the view-mode atoms outlive a test.
let run = 0;
let roomIds: string[] = [];
let memberScans = 0;
let rooms = new Map<string, { members: Record<string, Member> }>();

const createClient = () => {
  rooms = new Map();
  const roomObjects = new Map(
    roomIds.map((roomId, index) => {
      const members: Record<string, Member> = {};
      for (let m = 0; m < MEMBERS; m += 1) {
        const userId = `@person${m}:example.org`;
        members[userId] = { roomId, userId, membership: 'join' };
      }
      if (index % 2 === 0) members[AGENT] = { roomId, userId: AGENT, membership: 'join' };
      rooms.set(roomId, { members });
      return [
        roomId,
        {
          roomId,
          currentState: {},
          getMembers: () => {
            memberScans += 1;
            return Object.values(members);
          },
          getMember: (userId: string) => members[userId] ?? null,
        },
      ];
    })
  );
  return Object.assign(new EventEmitter(), {
    getHomeserverUrl: () => 'https://example.org',
    getSafeUserId: () => ME,
    getAccountData: () => undefined,
    getRoom: (roomId: string) => roomObjects.get(roomId) ?? null,
  });
};

let entryRenders = new Map<string, number>();
let setters: ((mode: RoomViewMode) => void)[] = [];
let modes: RoomViewMode[] = [];
const Entry = memo(({ index, roomId }: { index: number; roomId: string; tick: number }) => {
  entryRenders.set(roomId, (entryRenders.get(roomId) ?? 0) + 1);
  const { setViewMode, viewMode } = useRoomViewMode(roomId);
  setters[index] = setViewMode;
  modes[index] = viewMode;
  return null;
});

let rerender = () => undefined as void;
function Sidebar() {
  const [tick, setTick] = useState(0);
  rerender = () => setTick((value) => value + 1);
  return (
    <>
      {Array.from({ length: ENTRIES }, (_, index) => {
        const roomId = roomIds[index % ROOMS] ?? '';
        return <Entry key={index} index={index} roomId={roomId} tick={tick} />;
      })}
    </>
  );
}

const storage = new Map<string, string>();
let storageListeners = new Set<(event: StorageEvent) => void>();
let client = createClient();
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  run += 1;
  roomIds = Array.from({ length: ROOMS }, (_, index) => `!perf-${run}-${index}:example.org`);
  vi.stubGlobal('localStorage', {
    get length() {
      return storage.size;
    },
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  } as unknown as Storage);
  storageListeners = new Set();
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      if (type === 'storage') storageListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      if (type === 'storage') storageListeners.delete(listener);
    },
  });
  // The first half of the rooms has a chosen view; the rest open in their default.
  roomIds.slice(0, ROOMS / 2).forEach((roomId) => {
    storage.set(getRoomViewModeStorageKey(SESSION, roomId), JSON.stringify('compact'));
  });
  client = createClient();
  const store = createStore();
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  memberScans = 0;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={client as unknown as MatrixClient}>
          <Sidebar />
        </MatrixClientProvider>
      </Provider>
    );
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  setters = [];
  modes = [];
  entryRenders = new Map();
  storage.clear();
  client.removeAllListeners();
  vi.unstubAllGlobals();
});

const roomOf = (index: number) => roomIds[index % ROOMS] ?? '';

describe('a sidebar of many thread entries', () => {
  it('scans each room without a chosen view once, not once per entry and render', () => {
    expect(memberScans).toBeLessThanOrEqual(ROOMS / 2);
    expect(modes[5]).toBe('threaded');
    expect(modes[6]).toBe('compact');

    memberScans = 0;
    for (let i = 0; i < 20; i += 1) act(() => rerender());

    expect(memberScans).toBe(0);
  });

  it('scans a room again after a membership change in it and follows an agent joining', () => {
    const roomId = roomOf(7);
    const room = rooms.get(roomId);
    if (!room) throw new Error('missing room');
    memberScans = 0;

    act(() => {
      room.members[AGENT] = { roomId, userId: AGENT, membership: 'join' };
      client.emit(RoomMemberEvent.Membership, {} as MatrixEvent, room.members[AGENT], undefined);
    });

    expect(memberScans).toBe(1);
    expect(modes.filter((_, index) => roomOf(index) === roomId)).toEqual(
      Array(ENTRIES / ROOMS).fill('compact')
    );
  });

  it('re-renders only the entries of the room whose view the reader chose', () => {
    entryRenders = new Map();

    act(() => setters[1]?.('threaded'));

    expect([...entryRenders.keys()]).toEqual([roomOf(1)]);
    expect(entryRenders.get(roomOf(1))).toBe(ENTRIES / ROOMS);
  });

  it("follows another tab's choice of the view a room already shows by default", () => {
    // Room 5 has no agent and no choice: it shows Threads while its stored value is the default.
    const key = getRoomViewModeStorageKey(SESSION, roomOf(5));
    expect(modes[5]).toBe('threaded');

    storage.set(key, JSON.stringify('compact'));
    act(() => {
      storageListeners.forEach((listener) => listener({ key } as StorageEvent));
    });

    expect(modes[5]).toBe('compact');
  });
});
