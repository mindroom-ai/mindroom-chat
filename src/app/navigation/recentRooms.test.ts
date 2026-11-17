import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RECENT_ROOMS,
  bumpRecentRoom,
  clearRecentRoomsStore,
  getRecentRoomsAtom,
} from './recentRooms';

const USER_ID = '@alice:example.org';
const sessions = vi.hoisted(() => ({
  active: { userId: '@alice:example.org' } as { userId: string } | undefined,
}));

vi.mock('../matrix/session/sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/session/sessions')>()),
  getActiveSession: () => sessions.active,
}));

const createStorage = (): Storage => {
  const state = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => state.clear()),
    key: vi.fn(() => null),
    length: 0,
  };
};

const stored = (): unknown => JSON.parse(localStorage.getItem(`recentRooms:${USER_ID}`) ?? 'null');
const roomIds = () =>
  getDefaultStore()
    .get(getRecentRoomsAtom(USER_ID))
    .map((entry) => entry.roomId);

describe('recentRooms', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorage(),
    });
    sessions.active = { userId: USER_ID };
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearRecentRoomsStore(USER_ID);
    vi.useRealTimers();
  });

  it('keeps the rooms newest visit first, once each, and stores them for the account', () => {
    vi.setSystemTime(100);
    bumpRecentRoom('!a:example.org');
    vi.setSystemTime(200);
    bumpRecentRoom('!b:example.org');
    vi.setSystemTime(300);
    bumpRecentRoom('!a:example.org');

    expect(roomIds()).toEqual(['!a:example.org', '!b:example.org']);
    expect(stored()).toEqual({
      v: 1,
      entries: [
        { roomId: '!a:example.org', openedAt: 300 },
        { roomId: '!b:example.org', openedAt: 200 },
      ],
    });
  });

  it(`keeps the ${MAX_RECENT_ROOMS} newest visits`, () => {
    for (let index = 0; index <= MAX_RECENT_ROOMS; index += 1) {
      vi.setSystemTime(100 + index);
      bumpRecentRoom(`!room-${index}:example.org`);
    }

    expect(roomIds()).toHaveLength(MAX_RECENT_ROOMS);
    expect(roomIds()[0]).toBe(`!room-${MAX_RECENT_ROOMS}:example.org`);
    expect(roomIds()).not.toContain('!room-0:example.org');
  });

  it('reads what an earlier session stored and drops what is malformed', () => {
    localStorage.setItem(
      `recentRooms:${USER_ID}`,
      JSON.stringify({
        v: 1,
        entries: [
          { roomId: '!old:example.org', openedAt: 100 },
          { roomId: '!new:example.org', openedAt: 200 },
          { roomId: '', openedAt: 300 },
          { roomId: '!bad:example.org', openedAt: 'soon' },
        ],
      })
    );

    expect(roomIds()).toEqual(['!new:example.org', '!old:example.org']);
  });

  it('records nothing while no one is signed in', () => {
    sessions.active = undefined;
    bumpRecentRoom('!a:example.org');

    expect(roomIds()).toEqual([]);
    expect(stored()).toBeNull();
  });

  it('forgets the account visits on clear', () => {
    bumpRecentRoom('!a:example.org');
    clearRecentRoomsStore(USER_ID);

    expect(stored()).toBeNull();
    expect(roomIds()).toEqual([]);
  });
});
