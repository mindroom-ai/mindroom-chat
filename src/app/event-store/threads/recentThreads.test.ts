import { createStore, getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bumpRecentThread,
  clearRecentThreadsStore,
  makeRecentThreadsAtom,
  rekeyRecentThread,
  removeRecentThread,
} from './recentThreads';
import { setImperativeJotaiStore } from '../../lib/state/jotaiStore';

const USER_ID = '@alice:example.org';
const sessions = vi.hoisted(() => ({
  active: { userId: '@alice:example.org' } as { userId: string } | undefined,
}));

vi.mock('../../matrix/session/sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/session/sessions')>()),
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

  it('bumps an entry to the top and de-duplicates the same room/thread pair', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$older',
      openedAt: 100,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$newer',
      openedAt: 200,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$older',
      openedAt: 300,
    });

    expect(store.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$older',
        openedAt: 300,
      },
      {
        roomId: '!room:example.org',
        threadId: '$newer',
        openedAt: 200,
      },
    ]);
  });

  it('ignores local-echo thread ids when bumping recent threads', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '~pending',
      openedAt: 100,
    });

    expect(store.get(recentThreadsAtom)).toEqual([]);
  });

  it('drops legacy local-echo thread ids from stored recent threads', () => {
    localStorage.setItem(
      'recentThreads:@alice:example.org',
      JSON.stringify({
        v: 1,
        entries: [
          {
            roomId: '!room:example.org',
            threadId: '~pending',
            openedAt: 200,
          },
          {
            roomId: '!room:example.org',
            threadId: '$confirmed',
            openedAt: 100,
          },
        ],
      })
    );

    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);

    expect(getDefaultStore().get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$confirmed',
        openedAt: 100,
      },
    ]);
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

  it('does not rekey a recent thread to a local-echo id', () => {
    const providerStore = createStore();
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const unregisterStore = setImperativeJotaiStore(providerStore);

    providerStore.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$confirmed',
      openedAt: 100,
    });

    rekeyRecentThread('!room:example.org', '$confirmed', '~pending');

    expect(providerStore.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$confirmed',
        openedAt: 100,
      },
    ]);

    unregisterStore();
  });

  it('writes imperative recent-thread bumps into the registered provider store', () => {
    const providerStore = createStore();
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const unregisterStore = setImperativeJotaiStore(providerStore);

    bumpRecentThread('!room:example.org', '$thread', 200, 'Preview text');

    expect(providerStore.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$thread',
        openedAt: 200,
        summaryText: 'Preview text',
      },
    ]);
    expect(getDefaultStore().get(recentThreadsAtom)).toEqual([]);

    unregisterStore();
  });

  it('removes one thread of the signed-in account', () => {
    bumpRecentThread('!room:example.org', '$kept', 100);
    bumpRecentThread('!room:example.org', '$gone', 200);

    removeRecentThread('!room:example.org', '$gone');

    expect(getDefaultStore().get(makeRecentThreadsAtom(USER_ID))).toEqual([
      { roomId: '!room:example.org', threadId: '$kept', openedAt: 100 },
    ]);
  });

  it.each([
    ['no session', undefined],
    ['a session without a user', { userId: '' }],
  ])('records nothing with %s', (_name, session) => {
    sessions.active = session;
    try {
      bumpRecentThread('!room:example.org', '$thread', 200);
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(getDefaultStore().get(makeRecentThreadsAtom(''))).toEqual([]);
    } finally {
      sessions.active = { userId: USER_ID };
    }
  });

  it('updates a stored summary without changing recency order', () => {
    const providerStore = createStore();
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const unregisterStore = setImperativeJotaiStore(providerStore);

    providerStore.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$older',
      openedAt: 100,
    });
    providerStore.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$newer',
      openedAt: 200,
    });

    bumpRecentThread('!room:example.org', '$older', 100, 'Stored preview');

    expect(providerStore.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$newer',
        openedAt: 200,
      },
      {
        roomId: '!room:example.org',
        threadId: '$older',
        openedAt: 100,
        summaryText: 'Stored preview',
      },
    ]);

    unregisterStore();
  });
});
