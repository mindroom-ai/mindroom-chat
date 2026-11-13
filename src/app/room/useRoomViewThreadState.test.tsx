// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../preferences/settings';
import {
  getRoomThreadFilterStorageKey,
  roomThreadFilterAtomFamily,
} from '../threads/overview/roomThreadFilterState';
import {
  createDefaultThreadFilterState,
  serializeThreadFilterState,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { useEdgeSwipeForward } from '../navigation/useEdgeSwipeForward';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import { bumpRecentThread } from '../event-store/threads/recentThreads';
import { useRoomViewThreadState, type RoomViewThreadState } from './useRoomViewThreadState';

const USER_ID = '@alice:example.org';
const ROOM_ID = '!room:example.org';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const joinedRooms = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => USER_ID,
    getHomeserverUrl: () => 'https://example.org',
    getRooms: () => joinedRooms.list,
  }),
}));
const navigation = vi.hoisted(() => ({
  navigatePath: vi.fn(),
  navigateRoom: vi.fn(),
  navigateRoomFocusEvent: vi.fn(),
  navigateRoomThread: vi.fn(),
  navigateRoomThreadDirect: vi.fn(),
}));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('../navigation/useEdgeSwipeBack', () => ({ useEdgeSwipeBack: vi.fn() }));
vi.mock('../navigation/useEdgeSwipeForward', () => ({ useEdgeSwipeForward: vi.fn() }));
vi.mock('../event-store/threads/recentThreads', () => ({ bumpRecentThread: vi.fn() }));
vi.mock('../event-store/threads/recentThreadSummaryUtils', () => ({
  resolveRecentThreadSummaryText: () => 'Root',
}));
vi.mock('../event-store/threads/useRoomThreadSummaryState', () => ({
  useRoomThreadSummaryState: () => ({ summaryMap: new Map(), storeThreadSummary: vi.fn() }),
}));
vi.mock('../threads/useThreadRootEvent', () => ({ useThreadRootEvent: () => undefined }));
const cachedRoot = vi.hoisted(() => ({ event: undefined as unknown }));
vi.mock('../event-store/sdk/cachedThreadRoots', () => ({
  useCachedThreadRoot: () => cachedRoot.event,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'compact', setViewMode: vi.fn() }),
}));

/** A joined room that holds the events of `eventIds`. */
const roomHolding = (roomId: string, eventIds: string[] = []) =>
  ({
    roomId,
    getMyMembership: () => 'join',
    getThread: () => undefined,
    findEventById: (eventId: string) =>
      eventIds.includes(eventId)
        ? new MatrixEvent({
            event_id: eventId,
            room_id: roomId,
            type: 'm.room.message',
            sender: USER_ID,
            origin_server_ts: 1,
            content: { msgtype: 'm.text', body: 'Root' },
          })
        : undefined,
  } as unknown as Room);

let room = roomHolding(ROOM_ID);

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  localStorage.clear();
  room = roomHolding(ROOM_ID);
  joinedRooms.list = [];
  cachedRoot.event = undefined;
  vi.clearAllMocks();
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
  return {
    store,
    current: () => latest as RoomViewThreadState,
    rerender: () =>
      act(() => {
        renderer?.update(
          <Provider store={store}>
            <Probe />
          </Provider>
        );
      }),
  };
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

  it('remembers a thread as recent once its root is in the room', () => {
    room = roomHolding(ROOM_ID, ['$root']);

    mountThreadState({ threadId: '$root' });

    expect(bumpRecentThread).toHaveBeenCalledWith(ROOM_ID, '$root', undefined, 'Root');
  });

  it('remembers no thread whose root the room does not hold', () => {
    mountThreadState({ threadId: '$elsewhere' });

    expect(bumpRecentThread).not.toHaveBeenCalled();
  });

  it('opens a thread this room does not hold in the joined room that holds its root', () => {
    const other = roomHolding('!other:example.org', ['$elsewhere']);
    joinedRooms.list = [room, other];
    const { current } = mountThreadState({ threadId: '$elsewhere' });

    act(() => current().handleThreadLoadError('$elsewhere'));

    expect(navigation.navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!other:example.org',
      '$elsewhere',
      undefined,
      { replace: true }
    );
    expect(current().threadNotFound).toBe(false);
  });

  it('keeps a thread that does not load when this room holds its root', () => {
    room = roomHolding(ROOM_ID, ['$here']);
    joinedRooms.list = [room];
    const { current } = mountThreadState({ threadId: '$here' });

    act(() => current().handleThreadLoadError('$here'));

    expect(navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
    expect(current().threadNotFound).toBe(false);
  });

  it('shows a thread that no joined room holds as not found', () => {
    const left = {
      ...roomHolding('!left:example.org', ['$elsewhere']),
      getMyMembership: () => 'leave',
    };
    joinedRooms.list = [room, left];
    const { current } = mountThreadState({ threadId: '$elsewhere' });

    act(() => current().handleThreadLoadError('$elsewhere'));

    expect(navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
    expect(current().threadNotFound).toBe(true);
  });

  it('keeps a thread that does not load when the event cache holds its root for this room', () => {
    cachedRoot.event = roomHolding(ROOM_ID, ['$cached']).findEventById('$cached');
    joinedRooms.list = [room];
    const { current } = mountThreadState({ threadId: '$cached' });

    act(() => current().handleThreadLoadError('$cached'));

    expect(navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
    expect(current().threadNotFound).toBe(false);
    // Offline, a thread opened from the cache is remembered as recent too.
    expect(bumpRecentThread).toHaveBeenCalledWith(ROOM_ID, '$cached', undefined, 'Root');
  });

  it('shows a thread whose cached root arrives after it failed to load', () => {
    joinedRooms.list = [room];
    const { current, rerender } = mountThreadState({ threadId: '$cached' });
    act(() => current().handleThreadLoadError('$cached'));
    expect(current().threadNotFound).toBe(true);

    cachedRoot.event = roomHolding(ROOM_ID, ['$cached']).findEventById('$cached');
    rerender();
    expect(current().threadNotFound).toBe(false);
  });

  it('tries a thread that was not found again when it is opened again', () => {
    const store = createStore();
    let latest: RoomViewThreadState | undefined;
    function Probe({ threadId }: { threadId?: string }) {
      latest = useRoomViewThreadState({ room, threadId });
      return null;
    }
    const show = (threadId?: string) =>
      act(() => {
        const tree = (
          <Provider store={store}>
            <Probe threadId={threadId} />
          </Provider>
        );
        if (renderer) renderer.update(tree);
        else renderer = create(tree);
      });
    show('$elsewhere');
    act(() => latest?.handleThreadLoadError('$elsewhere'));
    expect(latest?.threadNotFound).toBe(true);

    show(undefined);
    show('$elsewhere');
    expect(latest?.threadNotFound).toBe(false);
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
