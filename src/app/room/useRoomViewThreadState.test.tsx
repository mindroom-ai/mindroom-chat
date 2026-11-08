// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../preferences/settings';
import { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } from '../threads/overview/roomThreadFilterState';
import {
  createDefaultThreadFilterState,
  serializeThreadFilterState,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { useEdgeSwipeForward } from '../navigation/useEdgeSwipeForward';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import { useRoomViewThreadState, type RoomViewThreadState } from './useRoomViewThreadState';

const USER_ID = '@alice:example.org';
const ROOM_ID = '!room:example.org';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => USER_ID,
    getHomeserverUrl: () => 'https://example.org',
  }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigatePath: vi.fn(),
    navigateRoom: vi.fn(),
    navigateRoomFocusEvent: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));
vi.mock('../navigation/useEdgeSwipeBack', () => ({ useEdgeSwipeBack: vi.fn() }));
vi.mock('../navigation/useEdgeSwipeForward', () => ({ useEdgeSwipeForward: vi.fn() }));
vi.mock('../event-store/threads/recentThreads', () => ({ bumpRecentThread: vi.fn() }));
vi.mock('../event-store/threads/useRoomThreadSummaryState', () => ({
  useRoomThreadSummaryState: () => ({ summaryMap: new Map(), storeThreadSummary: vi.fn() }),
}));
vi.mock('../threads/useThreadRootEvent', () => ({ useThreadRootEvent: () => undefined }));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'compact', setViewMode: vi.fn() }),
}));

const room = {
  roomId: ROOM_ID,
  getThread: () => undefined,
  findEventById: () => undefined,
} as unknown as Room;

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  localStorage.clear();
});

const storeFilter = (filter: ThreadFilterState) =>
  localStorage.setItem(
    getRoomThreadFilterStorageKey(USER_ID, ROOM_ID),
    JSON.stringify(serializeThreadFilterState(filter))
  );

/** Mounts the hook in its own store and hands back a reader for its latest result. */
const mountThreadState = ({
  advancedFilters = false,
  ...options
}: { hasMindroomAgents?: boolean; advancedFilters?: boolean; threadId?: string } = {}) => {
  const store = createStore();
  if (advancedFilters) store.set(settingsAtom, { ...getSettings(), simpleThreadFilters: false });
  let latest: RoomViewThreadState | undefined;
  function Probe() {
    latest = useRoomViewThreadState({ room, ...options });
    return null;
  }
  act(() => {
    renderer = create(
      <Provider store={store}>
        <Probe />
      </Provider>
    );
  });
  return { store, current: () => latest as RoomViewThreadState };
};

describe('useRoomViewThreadState', () => {
  const enabled = (hook: typeof useEdgeSwipeBack | typeof useEdgeSwipeForward) =>
    vi.mocked(hook).mock.lastCall?.[1];

  it("keeps the swipe out of a thread off while a side panel takes the conversation's place", () => {
    const { store } = mountThreadState({ threadId: '$thread' });
    expect(enabled(useEdgeSwipeBack)).toBe(true);
    act(() => store.set(conversationBehindPanelAtom, true));
    expect(enabled(useEdgeSwipeBack)).toBe(false);
  });

  it("keeps the swipe back into a thread off while a side panel takes the conversation's place", () => {
    const { store } = mountThreadState();
    act(() => store.set(lastExitedThreadAtom, { roomId: ROOM_ID, threadId: '$thread' }));
    expect(enabled(useEdgeSwipeForward)).toBe(true);
    act(() => store.set(conversationBehindPanelAtom, true));
    expect(enabled(useEdgeSwipeForward)).toBe(false);
  });

  it('applies the thread filter stored for the room', () => {
    storeFilter({ ...createDefaultThreadFilterState(), resolved: 'exclude' });

    const { current } = mountThreadState();

    expect(current().threadFilterState.resolved).toBe('exclude');
  });

  it('stores a filter chosen in the bar for this room only', () => {
    const { store, current } = mountThreadState();

    act(() => current().handleToggle('resolved'));
    act(() => current().handleToggle('resolved'));

    expect(current().threadFilterState.resolved).toBe('exclude');
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID)).resolved).toBe('exclude');
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, '!other:example.org')).resolved).toBe(
      'any'
    );
  });

  it('keeps agent filters stored but inactive in a room without agents', () => {
    storeFilter({ ...createDefaultThreadFilterState(), resolved: 'exclude', sortBy: 'natural' });

    const { store, current } = mountThreadState({ hasMindroomAgents: false });

    expect(current().threadFilterState.resolved).toBe('any');
    expect(current().threadFilterState.sortBy).toBe('natural');
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID)).resolved).toBe('exclude');
  });

  it('locks and unlocks the sort order in advanced filters, and forgets the lock when the sort turns natural', () => {
    const { current } = mountThreadState({ advancedFilters: true });

    act(() => current().handleToggleThreadSortFreeze());
    expect(current().threadSortFreezeState).toEqual({ controlSignature: null, orderedRootIds: [] });

    act(() => current().handleSortDirectionChange());
    expect(current().threadFilterState).toMatchObject({
      sortBy: 'lastReply',
      sortDirection: 'asc',
    });
    expect(current().threadSortFreezeState).not.toBeNull();

    act(() => current().handleSortDirectionChange());
    expect(current().threadFilterState.sortBy).toBe('natural');
    expect(current().threadSortFreezeState).toBeNull();
  });

  it('clears every tag filter or every chosen person in one change, keeping the rest', () => {
    storeFilter({
      ...createDefaultThreadFilterState(),
      resolved: 'exclude',
      tags: new Map([
        ['bug', 'include'],
        ['docs', 'exclude'],
      ]),
      people: ['@bob:example.org', '@carol:example.org'],
    });
    const { store, current } = mountThreadState({ advancedFilters: true });

    act(() => current().handleClearTags());
    expect(current().threadFilterState.tags.size).toBe(0);
    expect(current().threadFilterState.people).toEqual(['@bob:example.org', '@carol:example.org']);

    act(() => current().handleClearPeople());
    expect(current().threadFilterState.people).toEqual([]);
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))).toMatchObject({
      resolved: 'exclude',
      people: [],
    });
  });

  it('applies a typed query that is still waiting before it clears the tags', () => {
    const { current } = mountThreadState({ advancedFilters: true });

    act(() => current().handleSearchQueryChange('tag:bug launch'));
    act(() => current().handleClearTags());

    expect(current().threadFilterState.tags.size).toBe(0);
    expect(current().threadFilterState.freeText).toBe('launch');
  });

  it('starts with the simple filters, which keep no sort lock', () => {
    const { current } = mountThreadState();

    act(() => current().handleToggleThreadSortFreeze());

    expect(current().threadSortFreezeState).toBeNull();
  });
});
