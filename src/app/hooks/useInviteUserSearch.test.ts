import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';

import {
  INVITE_SERVER_SEARCH_LIMIT,
  userDirectoryCacheAtom,
  type UserDirectoryCacheState,
} from '../state/userDirectoryCache';
import { MatrixClientProvider } from './useMatrixClient';
import { useInviteUserSearch } from './useInviteUserSearch';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

vi.mock('./useDirectUsers', () => ({
  useDirectUsers: () => directUsersMock.users,
}));

type MockMatrixClient = Pick<MatrixClient, 'baseUrl' | 'getSafeUserId' | 'searchUserDirectory'>;

type SearchHarnessState = ReturnType<typeof useInviteUserSearch>;

const readyCache = (
  users: UserDirectoryCacheState['users'] = [],
  isBootstrapOnly = false,
  ownerKey = '@me:example.org|https://example.org'
): UserDirectoryCacheState => ({
  users,
  status: 'ready',
  fetchedAt: Date.now(),
  limited: false,
  isBootstrapOnly,
  ownerKey,
});

const makeMx = (): MockMatrixClient => ({
  baseUrl: 'https://example.org',
  getSafeUserId: vi.fn(() => '@me:example.org'),
  searchUserDirectory: vi.fn(),
});

const makeMxForUser = (userId: string, baseUrl: string): MockMatrixClient => ({
  baseUrl,
  getSafeUserId: vi.fn(() => userId),
  searchUserDirectory: vi.fn(),
});

const makeRoom = (): Pick<Room, 'getMember'> => ({
  getMember: () => null,
});

const originalWindow = globalThis.window;

function SearchHarness({
  room,
  query,
  onRender,
}: {
  room: Pick<Room, 'getMember'>;
  query: string;
  onRender: (state: SearchHarnessState) => void;
}) {
  const result = useInviteUserSearch(room as Room, query);
  onRender(result);
  return null;
}

const searchHarnessTree = (
  store: ReturnType<typeof createStore>,
  mx: MockMatrixClient,
  room: Pick<Room, 'getMember'>,
  query: string,
  onRender: (state: SearchHarnessState) => void
) =>
  React.createElement(
    Provider,
    { store },
    React.createElement(
      MatrixClientProvider,
      { value: mx as MatrixClient },
      React.createElement(SearchHarness, {
        room,
        query,
        onRender,
      })
    )
  );

const renderSearch = ({
  store = createStore(),
  mx = makeMx(),
  room = makeRoom(),
  query,
  cacheState,
}: {
  store?: ReturnType<typeof createStore>;
  mx?: MockMatrixClient;
  room?: Pick<Room, 'getMember'>;
  query: string;
  cacheState?: UserDirectoryCacheState;
}) => {
  if (cacheState) store.set(userDirectoryCacheAtom, cacheState);

  let latestResult!: SearchHarnessState;
  const renders: SearchHarnessState[] = [];
  let renderer!: ReturnType<typeof create>;
  const onRender = (state: SearchHarnessState) => {
    latestResult = state;
    renders.push(state);
  };

  act(() => {
    renderer = create(searchHarnessTree(store, mx, room, query, onRender));
  });

  return {
    store,
    renderer,
    getResult: () => latestResult,
    getRenders: () => renders,
    update: (nextMx: MockMatrixClient, nextCacheState?: UserDirectoryCacheState) => {
      act(() => {
        if (nextCacheState) store.set(userDirectoryCacheAtom, nextCacheState);
        renderer.update(searchHarnessTree(store, nextMx, room, query, onRender));
      });
    },
  };
};

describe('useInviteUserSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    directUsersMock.users = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        performance: {
          now: vi.fn(() => 0),
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('keeps matching direct-message contacts available when directory search rejects', async () => {
    const mx = makeMx();
    directUsersMock.users = ['@direct-alice:example.org'];
    vi.mocked(mx.searchUserDirectory).mockRejectedValue(new Error('directory disabled'));
    const view = renderSearch({ mx, query: 'direct', cacheState: readyCache() });

    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@direct-alice:example.org',
    ]);
    const stableRenderCount = view.getRenders().length;

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'direct',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@direct-alice:example.org',
    ]);
    expect(
      view
        .getRenders()
        .slice(stableRenderCount)
        .every((state) => state.suggestions.length > 0)
    ).toBe(true);
  });

  it('searches the server for a real query when local matches came only from whitespace bootstrap', async () => {
    const mx = makeMx();
    const view = renderSearch({
      mx,
      query: 'alice',
      cacheState: readyCache(
        [
          { userId: '@alice-one:example.org', displayName: 'Alice One' },
          { userId: '@alice-two:example.org', displayName: 'Alice Two' },
          { userId: '@alice-three:example.org', displayName: 'Alice Three' },
          { userId: '@alice-four:example.org', displayName: 'Alice Four' },
          { userId: '@alice-five:example.org', displayName: 'Alice Five' },
        ],
        true
      ),
    });
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@alice-server:example.org', display_name: 'Alice Server' }],
    });

    expect(view.getResult().suggestions).toHaveLength(5);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'alice',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
  });

  it('strips a leading @ from the server search term', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@alice:example.org', display_name: 'Alice' }],
    });
    const view = renderSearch({ mx, query: '@alice', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'alice',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual(['@alice:example.org']);
  });

  it('does not expose per-keystroke server results from a previous MatrixClient owner', async () => {
    const clientA = makeMxForUser('@a:example.org', 'https://a.example.org');
    const clientB = makeMxForUser('@b:example.org', 'https://b.example.org');
    vi.mocked(clientA.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@remote-a:a.example.org', display_name: 'Remote A' }],
    });
    vi.mocked(clientB.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@remote-b:b.example.org', display_name: 'Remote B' }],
    });
    const view = renderSearch({
      mx: clientA,
      query: 'remote',
      cacheState: readyCache([], false, '@a:example.org|https://a.example.org'),
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@remote-a:a.example.org'
    );

    view.update(clientB, readyCache([], false, '@b:example.org|https://b.example.org'));

    expect(view.getResult().suggestions.map((user) => user.userId)).not.toContain(
      '@remote-a:a.example.org'
    );
  });

  it('returns no suggestions and skips server search when the query is exactly @', async () => {
    const mx = makeMx();
    const view = renderSearch({
      mx,
      query: '@',
      cacheState: readyCache([
        { userId: '@alice:example.org', displayName: 'Alice' },
        { userId: '@bob:example.org', displayName: 'Bob' },
      ]),
    });

    expect(view.getResult().suggestions).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).not.toHaveBeenCalled();
  });

  it('searches the server when local results only collide on the shared agent prefix', async () => {
    const mx = makeMx();
    const bareAgents = [
      'alpha',
      'basil',
      'clio',
      'delta',
      'echo',
      'fable',
      'gamma',
      'helix',
      'iris',
      'juno',
      'kilo',
      'lyra',
      'mind',
      'nova',
      'oracle',
      'pico',
      'quill',
      'rho',
      'sarro',
      'tesla',
    ].map((name) => ({ userId: `@mindroom_${name}:example.org` }));
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@mindroom_mind:example.org', display_name: 'Mind' }],
    });
    const view = renderSearch({
      mx,
      query: 'mind',
      cacheState: readyCache(bareAgents),
    });

    expect(view.getResult().suggestions.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'mind',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(view.getResult().suggestions[0]?.userId).toBe('@mindroom_mind:example.org');
    expect(view.getResult().suggestions[0]?.displayName).toBe('Mind');
  });

  it('keeps the server fallback suppressed when enough strong local matches exist', async () => {
    const mx = makeMx();
    const view = renderSearch({
      mx,
      query: 'ali',
      cacheState: readyCache([
        { userId: '@alice:example.org', displayName: 'Alice Adams' },
        { userId: '@alicia:example.org', displayName: 'Alicia Keys' },
        { userId: '@malia:example.org', displayName: 'Alina Cooper' },
      ]),
    });

    expect(view.getResult().suggestions.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).not.toHaveBeenCalled();
  });

  it('strips a leading @ before ranking local suggestions', () => {
    const view = renderSearch({
      query: '@a',
      cacheState: readyCache([
        { userId: '@zephyr:example.org', displayName: 'Aardvark Team' },
        { userId: '@alpha:example.org', displayName: 'Alpha User' },
        { userId: '@brvo:server.org', displayName: 'Brvo User' },
      ]),
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@alpha:example.org',
      '@zephyr:example.org',
    ]);
    expect(
      view
        .getResult()
        .suggestions.every(
          (user) =>
            user.userId.slice(1).startsWith('a') ||
            user.displayName?.toLocaleLowerCase().startsWith('a')
        )
    ).toBe(true);
  });
});
