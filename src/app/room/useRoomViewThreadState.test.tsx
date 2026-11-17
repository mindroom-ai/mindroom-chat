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
  FILTER_PRESETS,
  serializeThreadFilterState,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { useEdgeSwipeForward } from '../navigation/useEdgeSwipeForward';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import { bumpRecentThread } from '../event-store/threads/recentThreads';
import { getCompactRoomSectionsAtom } from '../threads/overview/compactRoomSections';
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
    getRoom: () => undefined,
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
// What this room's event cache holds of a thread: its root and its rows.
const cachedPage = vi.hoisted(() => ({ rootEvent: undefined as unknown, events: [] as unknown[] }));
vi.mock('../event-store/cache/eventRepository', () => ({
  loadLatestCachedThreadEvents: vi.fn(async () => ({ ...cachedPage })),
}));
const viewMode = vi.hoisted(() => ({ current: 'compact' }));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: viewMode.current, setViewMode: vi.fn() }),
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
  cachedPage.rootEvent = undefined;
  cachedPage.events = [];
  vi.clearAllMocks();
  viewMode.current = 'compact';
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
  // A new element each time, so an update renders the probe again.
  const tree = () => (
    <Provider store={store}>
      <Probe />
    </Provider>
  );
  act(() => {
    renderer = create(tree());
  });
  const rerender = () => act(() => renderer?.update(tree()));
  return { store, current: () => latest as RoomViewThreadState, rerender };
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

  it('keeps the record of the thread just left while the address still names it', () => {
    const { store, current } = mountThreadState({ threadId: '$a' });

    act(() => current().handleExitThread());

    expect(store.get(lastExitedThreadAtom)).toEqual({ roomId: ROOM_ID, threadId: '$a' });
  });

  it('remembers a thread opened in its room as recent', () => {
    mountThreadState({ threadId: '$root' });

    expect(bumpRecentThread).toHaveBeenCalledWith(ROOM_ID, '$root', undefined, 'Root');
  });

  it('remembers no thread another joined room holds', () => {
    joinedRooms.list = [room, roomHolding('!other:example.org', ['$elsewhere'])];

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

  it('shows a thread that no joined room holds and the cache holds nothing of as not found', async () => {
    const left = {
      ...roomHolding('!left:example.org', ['$elsewhere']),
      getMyMembership: () => 'leave',
    };
    joinedRooms.list = [room, left];
    const { current } = mountThreadState({ threadId: '$elsewhere' });

    await act(async () => current().handleThreadLoadError('$elsewhere'));

    expect(navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
    expect(current().threadNotFound).toBe(true);
  });

  it.each([
    ['its root', { rootEvent: { event_id: '$cached' }, events: [] }],
    ['replies of it', { rootEvent: undefined, events: [{ event_id: '$reply' }] }],
  ])(
    'keeps a thread that does not load while the cache holds %s for this room',
    async (_, page) => {
      Object.assign(cachedPage, page);
      joinedRooms.list = [room];
      const { current } = mountThreadState({ threadId: '$cached' });

      await act(async () => current().handleThreadLoadError('$cached'));

      expect(navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
      expect(current().threadNotFound).toBe(false);
    }
  );

  it('tries a thread that was not found again when it is opened again', async () => {
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
    await act(async () => latest?.handleThreadLoadError('$elsewhere'));
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
    viewMode.current = 'threaded';
    const { store, current } = mountThreadState();

    act(() => current().handleToggle('resolved'));
    act(() => current().handleToggle('resolved'));

    expect(current().threadFilterState.resolved).toBe('exclude');
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))?.resolved).toBe('exclude');
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, '!other:example.org'))).toBeNull();
  });

  it('hides resolved threads in Compact until the reader chooses otherwise', () => {
    const { current } = mountThreadState();
    expect(current().threadFilterState.resolved).toBe('exclude');

    act(() => current().handleToggleUnresolvedOnly());
    expect(current().threadFilterState.resolved).toBe('any');

    act(() => renderer?.unmount());
    expect(mountThreadState().current().threadFilterState.resolved).toBe('any');
  });

  it('hides snoozed threads in Compact, and keeps that through a simple filter change', () => {
    const { current } = mountThreadState();
    expect(current().threadFilterState.snoozed).toBe('exclude');

    act(() => current().handleToggleUnresolvedOnly());
    expect(current().threadFilterState.snoozed).toBe('exclude');

    act(() => renderer?.unmount());
    viewMode.current = 'threaded';
    expect(mountThreadState().current().threadFilterState.snoozed).toBe('exclude');
  });

  it('shows snoozed threads by default outside Compact', () => {
    viewMode.current = 'threaded';
    expect(mountThreadState().current().threadFilterState.snoozed).toBe('any');
  });

  it('follows the view for its default until the reader chooses a filter', () => {
    const { current, rerender } = mountThreadState({ advancedFilters: true });
    expect(current().threadFilterState.resolved).toBe('exclude');

    viewMode.current = 'threaded';
    rerender();
    expect(current().threadFilterState.resolved).toBe('any');

    act(() => current().handleToggle('resolved'));
    viewMode.current = 'compact';
    rerender();
    expect(current().threadFilterState.resolved).toBe('include');
  });

  it('shows resolved threads by default outside Compact', () => {
    viewMode.current = 'threaded';
    expect(mountThreadState().current().threadFilterState.resolved).toBe('any');
  });

  it('keeps agent filters stored but inactive in a room without agents', () => {
    storeFilter({ ...createDefaultThreadFilterState(), resolved: 'exclude', sortBy: 'natural' });

    const { store, current } = mountThreadState({ hasMindroomAgents: false });

    expect(current().threadFilterState.resolved).toBe('any');
    expect(current().threadFilterState.sortBy).toBe('natural');
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))?.resolved).toBe('exclude');
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

  it('shows resolved and snoozed threads in Compact Sections and keeps every other filter', () => {
    storeFilter({
      ...createDefaultThreadFilterState(),
      resolved: 'exclude',
      snoozed: 'exclude',
      unread: 'include',
      freeText: 'launch',
    });
    const { store, current } = mountThreadState({ advancedFilters: true });
    expect(current().threadSections).toBe(false);

    act(() => current().handleToggleThreadSections());

    expect(current().threadSections).toBe(true);
    expect(current().threadFilterState).toMatchObject({
      resolved: 'any',
      snoozed: 'any',
      unread: 'include',
      freeText: 'launch',
    });
    // The room's stored filter stays as the reader set it, and the choice is the account's.
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))).toMatchObject({
      resolved: 'exclude',
      snoozed: 'exclude',
    });
    expect(store.get(getCompactRoomSectionsAtom(USER_ID)).on).toBe(true);

    act(() => current().handleToggleThreadSections());
    expect(current().threadFilterState).toMatchObject({ resolved: 'exclude', snoozed: 'exclude' });
  });

  describe('while Compact shows sections, the stored resolved and snoozed filters', () => {
    const hidden = { resolved: 'exclude', snoozed: 'exclude' } as const;
    /** Mounts with both stored as `exclude`, Sections on, and fake timers for the search pause. */
    const mountWithSections = () => {
      vi.useFakeTimers();
      storeFilter({ ...createDefaultThreadFilterState(), ...hidden });
      const mounted = mountThreadState({ advancedFilters: true });
      act(() => mounted.current().handleToggleThreadSections());
      const stored = () => mounted.store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID));
      const search = (query: string) => {
        act(() => mounted.current().handleSearchQueryChange(query));
        act(() => {
          vi.advanceTimersByTime(300);
        });
      };
      const sectionsOff = () => act(() => mounted.current().handleToggleThreadSections());
      return { ...mounted, stored, search, sectionsOff };
    };
    afterEach(() => {
      vi.useRealTimers();
    });

    it('survive a search edit, and apply again once Sections are off', () => {
      const { current, stored, search, sectionsOff } = mountWithSections();

      search('launch');

      expect(stored()).toMatchObject({ ...hidden, freeText: 'launch' });
      sectionsOff();
      expect(current().threadFilterState).toMatchObject({ ...hidden, freeText: 'launch' });
    });

    it('survive the status tokens of a search', () => {
      const { current, stored, search, sectionsOff } = mountWithSections();

      search('is:resolved is:snoozed launch');

      expect(stored()).toMatchObject({ ...hidden, freeText: 'launch' });
      sectionsOff();
      expect(current().threadFilterState).toMatchObject(hidden);
    });

    it('survive Sections going off while a typed query still waits', () => {
      vi.useFakeTimers();
      const { store, current } = mountThreadState({ advancedFilters: true });
      act(() => current().handleToggleThreadSections());

      act(() => current().handleSearchQueryChange('foo'));
      act(() => current().handleToggleThreadSections());
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // The room's defaults: a fresh Compact room hides resolved and snoozed threads.
      expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))).toMatchObject({
        ...hidden,
        freeText: 'foo',
      });
      expect(current().threadFilterState).toMatchObject({ ...hidden, freeText: 'foo' });
    });

    it.each([
      ['Reset', (state: RoomViewThreadState) => state.handleReset()],
      [
        'the All preset',
        (state: RoomViewThreadState) =>
          state.handleApplyPreset(FILTER_PRESETS.find((preset) => preset.id === 'all')!),
      ],
    ])('go back to the room defaults with %s', (_name, clear) => {
      vi.useFakeTimers();
      storeFilter({
        ...createDefaultThreadFilterState(),
        resolved: 'include',
        snoozed: 'any',
        idle: 'exclude',
      });
      const { store, current } = mountThreadState({ advancedFilters: true });
      act(() => current().handleToggleThreadSections());

      act(() => clear(current()));

      const defaults = { ...hidden, idle: 'any' };
      expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))).toMatchObject(defaults);
      act(() => current().handleToggleThreadSections());
      expect(current().threadFilterState).toMatchObject(defaults);
    });

    it('keep the idle filter too, through a search and a tag, until Sections are off', () => {
      vi.useFakeTimers();
      storeFilter({ ...createDefaultThreadFilterState(), ...hidden, idle: 'include' });
      const { store, current } = mountThreadState({ advancedFilters: true });
      act(() => current().handleToggleThreadSections());
      expect(current().threadFilterState.idle).toBe('any');

      act(() => current().handleSearchQueryChange('launch'));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => current().handleAddTag('bug'));

      expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID))).toMatchObject({
        idle: 'include',
        freeText: 'launch',
      });
      act(() => current().handleToggleThreadSections());
      expect(current().threadFilterState).toMatchObject({ ...hidden, idle: 'include' });
    });

    it('ignore an is:idle token of a search', () => {
      const { current, stored, search } = mountWithSections();

      search('is:idle');

      expect(stored()).toMatchObject({ ...hidden, idle: 'any' });
      // So the box, which shows the filters that apply, drops the token too.
      expect(current().threadFilterState.idle).toBe('any');
    });

    it('survive a preset', () => {
      const { current, stored, sectionsOff } = mountWithSections();
      const archived = FILTER_PRESETS.find((preset) => preset.id === 'archived')!;

      act(() => current().handleApplyPreset(archived));

      expect(stored()).toMatchObject(hidden);
      sectionsOff();
      expect(current().threadFilterState).toMatchObject(hidden);
    });
  });

  it('keeps the sort lock off while Compact shows sections, which have their own order', () => {
    const { current } = mountThreadState({ advancedFilters: true });
    act(() => current().handleToggleThreadSections());

    act(() => current().handleToggleThreadSortFreeze());

    expect(current().threadSortFreezeState).toBeNull();
  });

  it('leaves the filters of the Threads view alone when Compact shows sections', () => {
    storeFilter({ ...createDefaultThreadFilterState(), resolved: 'exclude' });
    viewMode.current = 'threaded';
    const { current } = mountThreadState({ advancedFilters: true });

    act(() => current().handleToggleThreadSections());

    expect(current().threadSections).toBe(false);
    expect(current().threadFilterState.resolved).toBe('exclude');
  });
});
