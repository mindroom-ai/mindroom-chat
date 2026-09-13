import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecentThreadsStore, makeRecentThreadsAtom } from './recentThreads';

const USER_ID = '@alice:example.org';

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
    clear: vi.fn(() => {
      state.clear();
    }),
    key: vi.fn(() => null),
    length: 0,
  };
};

describe('recentThreads', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorage(),
    });
  });

  afterEach(() => {
    clearRecentThreadsStore(USER_ID);
  });

  it('rekeys reply ids to canonical roots without downgrading a newer canonical entry', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$root',
      openedAt: 200,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$other',
      openedAt: 150,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$reply',
      openedAt: 100,
    });

    store.set(recentThreadsAtom, {
      type: 'REKEY',
      roomId: '!room:example.org',
      threadId: '$reply',
      nextThreadId: '$root',
    });

    expect(store.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$root',
        openedAt: 200,
      },
      {
        roomId: '!room:example.org',
        threadId: '$other',
        openedAt: 150,
      },
    ]);
  });

  it('renames a stored reply id to the canonical root when no canonical entry exists yet', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$reply',
      openedAt: 125,
    });

    store.set(recentThreadsAtom, {
      type: 'REKEY',
      roomId: '!room:example.org',
      threadId: '$reply',
      nextThreadId: '$root',
    });

    expect(store.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$root',
        openedAt: 125,
      },
    ]);
  });
});
