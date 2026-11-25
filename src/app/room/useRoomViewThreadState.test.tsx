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
  hasActiveThreadFilters,
  serializeThreadFilterState,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { matchesThreadRecordFilterState } from '../event-store/threads/threadRecordOverview';
import type { ThreadRecord } from '../event-store/threads/types';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { SWIPE_PRIORITY } from '../navigation/interactiveSwipe';
import {
  clearPhoneSwipePreviews,
  PHONE_PAGE,
  PHONE_STAGE,
  setActivePhoneSwipeContext,
} from '../navigation/phonePageSlide';
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
const cachedPage = vi.hoisted(() => ({ rootEvent: undefined, events: [] as unknown[] }));
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
  }) as unknown as Room;

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
  clearPhoneSwipePreviews();
  setActivePhoneSwipeContext(undefined);
  document.body.replaceChildren();
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

    vi.useFakeTimers();
    act(() => current().handleSearchQueryChange('-is:resolved'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();

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

  it('defaults only advanced Compact agent rooms to Needs you and preserves a chosen tab', () => {
    const { current, rerender } = mountThreadState({ advancedFilters: true });
    expect(current().threadFilterState.tab).toBe('needsYou');
    expect(current().threadFilterState.resolved).toBe('any');
    viewMode.current = 'threaded';
    rerender();
    expect(current().threadFilterState.tab).toBeUndefined();
    expect(hasActiveThreadFilters(current().threadFilterState)).toBe(false);
    act(() => current().handleSelectTab('working'));
    viewMode.current = 'compact';
    rerender();
    expect(current().threadFilterState.tab).toBe('working');
  });

  it('keeps a sending root visible when it starts streaming in default advanced Threads', () => {
    viewMode.current = 'threaded';
    const { current } = mountThreadState({ advancedFilters: true });
    const root: ThreadRecord = {
      roomId: ROOM_ID,
      threadRootId: '$sending',
      presentation: {
        summaryInfo: undefined,
        summaryText: undefined,
        rootPreviewText: undefined,
        latestReplyPreviewText: undefined,
        lastSenderId: undefined,
        lastSenderDisplayName: undefined,
        messageCount: 0,
        participantIds: [],
        replyParticipantIds: [],
        primarySummaryText: undefined,
        recentThreadSummaryText: undefined,
      },
      cache: { eventCount: 0, relationSnapshotComplete: false, tailLoaded: false },
      absoluteIndex: 0,
      status: {
        isKnownThreadRoot: true,
        replyCount: 0,
        isResolved: false,
        isUnread: false,
        isStreaming: false,
        hasPendingSend: true,
        scheduledTaskCount: 0,
        tags: [],
      },
    };
    expect(matchesThreadRecordFilterState(root, current().threadFilterState)).toBe(true);
    root.status.hasPendingSend = false;
    root.status.isStreaming = true;
    expect(matchesThreadRecordFilterState(root, current().threadFilterState)).toBe(true);
  });

  it('shows resolved threads by default outside Compact', () => {
    viewMode.current = 'threaded';
    expect(mountThreadState().current().threadFilterState.resolved).toBe('any');
  });

  it('keeps For me when switching filter modes in rooms without agents, until reset', () => {
    const { store, current } = mountThreadState({ hasMindroomAgents: false });
    act(() => current().handleToggleForMe());
    expect(current().threadFilterState.forMe).toBe(true);
    act(() => store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: false }));
    expect(current().threadFilterState.forMe).toBe(true);
    act(() => current().handleReset());
    expect(current().threadFilterState.forMe).toBe(false);
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

  it('turns Compact Sections on for the account and leaves every filter as it was', () => {
    storeFilter({
      ...createDefaultThreadFilterState(),
      resolved: 'exclude',
      snoozed: 'exclude',
      unread: 'include',
      freeText: 'launch',
    });
    const { store, current } = mountThreadState({ advancedFilters: true });
    const before = current().threadFilterState;
    expect(current().threadSections).toBe(false);

    act(() => current().handleToggleThreadSections());

    expect(current().threadSections).toBe(true);
    expect(store.get(getCompactRoomSectionsAtom(USER_ID)).on).toBe(true);
    // Sections group whatever the filters show: no filter changes with them.
    expect(current().threadFilterState).toEqual(before);

    act(() => current().handleToggleThreadSections());
    expect(current().threadSections).toBe(false);
    expect(current().threadFilterState).toEqual(before);
  });

  it('keeps the selected tab while Compact shows sections', () => {
    const { current } = mountThreadState({ advancedFilters: true });
    act(() => current().handleSelectTab('later'));

    act(() => current().handleToggleThreadSections());

    expect(current().threadFilterState.tab).toBe('later');
  });

  it('keeps the sort lock off while Compact shows sections, which have their own order', () => {
    const { current } = mountThreadState({ advancedFilters: true });
    act(() => current().handleToggleThreadSections());

    act(() => current().handleToggleThreadSortFreeze());

    expect(current().threadSortFreezeState).toBeNull();
  });

  it('shows no sections in a room without agents, whose cards keep their sort', () => {
    const { store, current } = mountThreadState({
      hasMindroomAgents: false,
      advancedFilters: true,
    });

    act(() => current().handleToggleThreadSections());

    expect(store.get(getCompactRoomSectionsAtom(USER_ID)).on).toBe(true);
    expect(current().threadSections).toBe(false);
  });

  it('shows no sections in the Threads view', () => {
    viewMode.current = 'threaded';
    const { current } = mountThreadState({ advancedFilters: true });

    act(() => current().handleToggleThreadSections());

    expect(current().threadSections).toBe(false);
  });
});

it('keeps the default Needs you tab while changing the sort or adding a tag', () => {
  const { current } = mountThreadState({ advancedFilters: true });
  act(() => current().handleSortDirectionChange());
  expect(current().threadFilterState.tab).toBe('needsYou');
  act(() => current().handleAddTag('review'));
  expect(current().threadFilterState.tab).toBe('needsYou');
  expect(current().threadFilterState.tags.get('review')).toBe('include');
});

it('restores the authoritative Done tab after toggling Unresolved in Simple mode', () => {
  const { current, store } = mountThreadState({ advancedFilters: true });
  act(() => current().handleSelectTab('done'));
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: true }));
  act(() => current().handleToggleUnresolvedOnly());
  expect(current().threadFilterState.resolved).toBe('exclude');
  expect(current().threadFilterState.tab).toBeUndefined();
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: false }));
  expect(current().threadFilterState.tab).toBe('done');
  expect(current().threadFilterState.resolved).toBe('any');
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: true }));
  expect(current().threadFilterState.resolved).toBe('exclude');
});

it('handleShowSnoozed lifts only snooze exclusion in Simple mode and selects Later in Advanced mode', () => {
  const simple = mountThreadState();
  act(() => simple.current().handleSortDirectionChange());
  const { sortBy, sortDirection } = simple.current().threadFilterState;
  expect(simple.current().threadFilterState.resolved).toBe('exclude');
  expect(simple.current().threadFilterState.snoozed).toBe('exclude');

  act(() => simple.current().handleShowSnoozed());
  expect(simple.current().threadFilterState.resolved).toBe('exclude');
  expect(simple.current().threadFilterState.snoozed).toBe('any');
  expect(simple.current().threadFilterState.sortBy).toBe(sortBy);
  expect(simple.current().threadFilterState.sortDirection).toBe(sortDirection);
  expect(simple.current().threadFilterState.tab).toBeUndefined();

  act(() => renderer?.unmount());
  localStorage.clear();

  const advanced = mountThreadState({ advancedFilters: true, hasMindroomAgents: true });
  expect(advanced.current().threadFilterState.tab).toBe('needsYou');
  act(() => advanced.current().handleShowSnoozed());
  expect(advanced.current().threadFilterState.tab).toBe('later');
});

describe('useRoomViewThreadState interactive swipe wiring', () => {
  const mountPhoneStage = (label: string) => {
    const stage = document.createElement('div');
    stage.setAttribute(PHONE_STAGE, '');
    const page = document.createElement('div');
    page.setAttribute(PHONE_PAGE, '');
    page.textContent = label;
    stage.append(page);
    document.body.append(stage);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      top: 0,
      left: 0,
      right: 390,
      bottom: 844,
      toJSON: () => ({}),
    });
    return { stage, page };
  };

  it('registers PAGE priority and interactive begin scenes on back and forward edge swipes', () => {
    const { store } = mountThreadState({ threadId: '$thread' });
    const backOptions = vi.mocked(useEdgeSwipeBack).mock.lastCall?.[2];
    expect(backOptions?.priority).toBe(SWIPE_PRIORITY.PAGE);
    expect(typeof backOptions?.begin).toBe('function');

    act(() => store.set(lastExitedThreadAtom, { roomId: ROOM_ID, threadId: '$thread' }));
    const forwardOptions = vi.mocked(useEdgeSwipeForward).mock.lastCall?.[2];
    expect(forwardOptions?.priority).toBe(SWIPE_PRIORITY.PAGE);
    expect(typeof forwardOptions?.begin).toBe('function');
  });

  it('cancelled back drag leaves route navigation and lastExitedThreadAtom untouched', async () => {
    const { stage, page } = mountPhoneStage('Thread');
    const { store } = mountThreadState({ threadId: '$thread' });
    const begin = vi.mocked(useEdgeSwipeBack).mock.lastCall?.[2]?.begin;
    const scene = begin?.({ axisSign: 1, dirSign: 1 });
    expect(scene).not.toBeNull();

    scene!.update(90, 90 / 390);
    expect(page.style.translate).toBe('90px');

    await scene!.settle(false, 0, 90);
    scene!.cleanup(false);

    expect(store.get(lastExitedThreadAtom)).toBeNull();
    expect(navigation.navigateRoomFocusEvent).not.toHaveBeenCalled();
    expect(navigation.navigatePath).not.toHaveBeenCalled();
    expect(page.style.translate).toBe('');
    expect(stage.hasAttribute('data-swipe-stage')).toBe(false);
    expect(stage.querySelector('[data-swipe-preview]')).toBeNull();
  });

  it('cancelled forward drag leaves lastExitedThreadAtom intact and does not navigate', async () => {
    const { stage, page } = mountPhoneStage('Room');
    const { store, rerender } = mountThreadState();
    act(() => store.set(lastExitedThreadAtom, { roomId: ROOM_ID, threadId: '$thread' }));
    rerender();

    const begin = vi.mocked(useEdgeSwipeForward).mock.lastCall?.[2]?.begin;
    const scene = begin?.({ axisSign: -1, dirSign: 1 });
    expect(scene).not.toBeNull();

    scene!.update(80, 80 / 390);
    await scene!.settle(false, 0, 80);
    scene!.cleanup(false);

    expect(store.get(lastExitedThreadAtom)).toEqual({ roomId: ROOM_ID, threadId: '$thread' });
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
    expect(page.style.translate).toBe('');
    expect(stage.hasAttribute('data-swipe-stage')).toBe(false);
    expect(stage.querySelector('[data-swipe-preview]')).toBeNull();
  });

  it('committed back drag exits thread, sets lastExitedThreadAtom, and caches thread preview', async () => {
    const { stage } = mountPhoneStage('Active Thread Body');
    const { store, rerender } = mountThreadState({ threadId: '$thread' });
    const begin = vi.mocked(useEdgeSwipeBack).mock.lastCall?.[2]?.begin;
    const scene = begin?.({ axisSign: 1, dirSign: 1 });
    expect(scene).not.toBeNull();

    scene!.update(260, 260 / 390);
    await scene!.settle(true, 0, 260);
    act(() => {
      scene!.commit();
      scene!.cleanup(true);
    });

    expect(store.get(lastExitedThreadAtom)).toEqual({ roomId: ROOM_ID, threadId: '$thread' });
    expect(navigation.navigateRoomFocusEvent).toHaveBeenCalledWith(ROOM_ID, '$thread', {
      replace: true,
    });
    // Release the interactive handoff by removing data-phone-stage briefly, then re-adding it.
    stage.removeAttribute(PHONE_STAGE);
    await Promise.resolve();
    stage.setAttribute(PHONE_STAGE, '');
    rerender();
  });
});
