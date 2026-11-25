// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClientEvent,
  EventType,
  KnownMembership,
  MatrixEvent,
  MemoryStore,
  Room,
  createClient,
  type MatrixClient,
} from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { useHomeRooms } from '../../matrix/state/useHomeRooms';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { StateEvent, type RoomToParents } from '../../matrix/types/room';
import { makeClosedNavCategoriesAtom, makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../ui/nav/useClosedNavCategories';
import { useHomeRoomSections } from './useHomeRoomSections';

const ME = '@alice:example.org';

type FixtureRoom = {
  name: string;
  space?: boolean;
  createdAt?: number;
  lastMessageTs?: number;
  membership?: KnownMembership;
};

let eventSeq = 0;

const makeRealClient = (rooms: Record<string, FixtureRoom>) => {
  const client = createClient({
    baseUrl: 'https://example.org',
    userId: ME,
    store: new MemoryStore(),
  });

  Object.entries(rooms).forEach(([roomId, spec], index) => {
    const room = new Room(roomId, client, ME);
    room.updateMyMembership(spec.membership ?? KnownMembership.Join);
    const stateEvents = [
      new MatrixEvent({
        type: EventType.RoomCreate,
        state_key: '',
        sender: ME,
        room_id: roomId,
        event_id: `$create_${++eventSeq}`,
        origin_server_ts: spec.createdAt ?? (index + 1) * 1000,
        content: spec.space ? { type: 'm.space' } : {},
      }),
      new MatrixEvent({
        type: EventType.RoomName,
        state_key: '',
        sender: ME,
        room_id: roomId,
        event_id: `$name_${++eventSeq}`,
        origin_server_ts: (index + 1) * 1000 + 1,
        content: { name: spec.name },
      }),
      new MatrixEvent({
        type: StateEvent.RoomPowerLevels,
        state_key: '',
        sender: ME,
        room_id: roomId,
        event_id: `$pl_${++eventSeq}`,
        origin_server_ts: (index + 1) * 1000 + 2,
        content: { users: { [ME]: 100 }, state_default: 50 },
      }),
    ];
    room.currentState.setStateEvents(stateEvents);
    room
      .getLiveTimeline()
      .getState('f' as never)
      ?.setStateEvents(stateEvents);
    room.recalculate();
    if (spec.lastMessageTs !== undefined) {
      void room.addLiveEvents(
        [
          new MatrixEvent({
            type: EventType.RoomMessage,
            sender: ME,
            room_id: roomId,
            event_id: `$msg_${++eventSeq}`,
            origin_server_ts: spec.lastMessageTs,
            content: { msgtype: 'm.text', body: 'hello' },
          }),
        ],
        { addToState: false }
      );
    }
    client.store.storeRoom(room);
  });

  const setAccountData = vi.fn(async (type: string, content: Record<string, unknown>) => {
    const event = new MatrixEvent({ type, content });
    client.store.storeAccountDataEvents([event]);
    client.emit(ClientEvent.AccountData, event, undefined);
    return {};
  });
  client.setAccountData = setAccountData as unknown as MatrixClient['setAccountData'];
  return { client, setAccountData };
};

const makeStore = (
  joinedRooms: string[],
  parentsByRoom: Record<string, string[]>,
  directRooms: string[] = []
) => {
  const store = createStore();
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: joinedRooms });
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(directRooms) });
  const roomToParents: RoomToParents = new Map(
    Object.entries(parentsByRoom).map(([id, parents]) => [id, new Set(parents)])
  );
  store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents, chatRooms: [] });
  return store;
};

describe('useHomeRoomSections', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    localStorage.clear();
  });

  const mount = (
    client: MatrixClient,
    store: ReturnType<typeof createStore>,
    closedAtom = makeClosedNavCategoriesAtom(ME),
    selectedRoomId?: string
  ) => {
    const state = {} as {
      sections: ReturnType<typeof useHomeRoomSections>;
      homeRooms: string[];
    };
    const Probe = () => {
      state.sections = useHomeRoomSections(selectedRoomId);
      state.homeRooms = useHomeRooms();
      return null;
    };
    act(() => {
      renderer = create(
        <Provider store={store}>
          <MatrixClientProvider value={client}>
            <ClosedNavCategoriesProvider value={closedAtom}>
              <Probe />
            </ClosedNavCategoriesProvider>
          </MatrixClientProvider>
        </Provider>
      );
    });
    return { state, closedAtom };
  };

  it('reorders live with io.mindroom.spaces, keeps useHomeRooms unspaced-only, and persists collapse under home|space|<id>', async () => {
    const { client, setAccountData } = makeRealClient({
      '!notes': { name: 'Personal Notes', createdAt: 100 },
      '!work': { name: 'Work', space: true, createdAt: 200 },
      '!planning': { name: 'Weekly Planning', createdAt: 300 },
      '!design': { name: 'Design Team', space: true, createdAt: 400 },
      '!sketches': { name: 'Sketches', createdAt: 500 },
      '!garden': { name: 'Garden Club', space: true, createdAt: 600 },
      '!plants': { name: 'Plant Care', createdAt: 700 },
      '!dm': { name: 'Direct Chat', createdAt: 800 },
    });
    const parents = {
      '!design': ['!work'],
      '!planning': ['!work'],
      '!sketches': ['!design'],
      '!plants': ['!garden'],
    };
    const joined = [
      '!notes',
      '!work',
      '!planning',
      '!design',
      '!sketches',
      '!garden',
      '!plants',
      '!dm',
    ];
    const store = makeStore(joined, parents, ['!dm']);

    const { state } = mount(client, store);

    // Rail age order: Work (with sub-space Design Team right after it), then Garden Club.
    expect(state.sections.unspaced).toEqual(['!notes']);
    expect(state.sections.sections.map((section) => section.spaceId)).toEqual([
      '!work',
      '!design',
      '!garden',
    ]);
    // useHomeRooms stays unspaced-only; allVisibleHomeRooms includes space rooms (no DMs/spaces).
    expect(state.homeRooms).toEqual(['!notes']);
    expect(state.sections.allVisibleHomeRooms).toEqual([
      '!notes',
      '!plants',
      '!sketches',
      '!planning',
    ]);

    // Live rail reorder via io.mindroom.spaces moves Garden Club ahead of Work (and Design Team moves with Work).
    await act(async () => {
      await setAccountData(AccountDataEvent.MindroomSpaces, { sidebar: ['!garden', '!work'] });
    });
    expect(state.sections.sections.map((section) => section.spaceId)).toEqual([
      '!garden',
      '!work',
      '!design',
    ]);

    // Collapse Work under its Home category ID (home|space|!work) and verify persistence across reload.
    const workCategoryId = makeNavCategoryId('home', 'space', '!work');
    act(() => {
      state.sections.onCategoryClick({
        currentTarget: { getAttribute: () => workCategoryId },
      } as unknown as React.MouseEvent<HTMLElement>);
    });
    expect(state.sections.sections.find((s) => s.spaceId === '!work')?.closed).toBe(true);
    expect(state.sections.sections.find((s) => s.spaceId === '!work')?.listedRoomIds).toEqual([]);

    // Unmount and remount with a fresh store + fresh closedCategoriesAtom (simulating reload).
    act(() => renderer?.unmount());
    renderer = undefined;
    const reloadedStore = makeStore(joined, parents, ['!dm']);
    const reloaded = mount(client, reloadedStore, makeClosedNavCategoriesAtom(ME));
    expect(reloaded.state.sections.sections.find((s) => s.spaceId === '!work')?.closed).toBe(true);
    expect(reloaded.state.sections.sections.find((s) => s.spaceId === '!garden')?.closed).toBe(
      false
    );
    // Space sidebar's own category key (!work|room) remains untouched.
    expect(reloaded.closedAtom).toBeDefined();
    expect(reloadedStore.get(reloaded.closedAtom).has(makeNavCategoryId('!work', 'room'))).toBe(
      false
    );
  });

  it('supports per-space sort modes, sub-space inheritance, showTimes, and atomic manual snapshot', () => {
    const { client, setAccountData } = makeRealClient({
      '!work': { name: 'Work', space: true, createdAt: 100 },
      '!alpha': { name: 'Alpha', lastMessageTs: 1000 },
      '!zebra': { name: 'Zebra', lastMessageTs: 5000 },
      '!design': { name: 'Design Team', space: true, createdAt: 200 },
      '!beta': { name: 'Beta', lastMessageTs: 2000 },
      '!yankee': { name: 'Yankee', lastMessageTs: 6000 },
    });
    const store = makeStore(['!work', '!alpha', '!zebra', '!design', '!beta', '!yankee'], {
      '!alpha': ['!work'],
      '!zebra': ['!work'],
      '!design': ['!work'],
      '!beta': ['!design'],
      '!yankee': ['!design'],
    });

    const { state } = mount(client, store);
    const sectionOf = (spaceId: string) =>
      state.sections.sections.find((section) => section.spaceId === spaceId)!;

    // Top-level space has no sort.inherit; sub-space inherits from Work.
    expect(sectionOf('!work').sort?.inherit).toBeUndefined();
    expect(sectionOf('!design').sort?.inherit?.mode).toBe('name');
    expect(sectionOf('!design').sort?.inherit?.overridden).toBe(false);
    expect(sectionOf('!work').orderedTop).toEqual(['!alpha', '!zebra']);
    expect(sectionOf('!design').orderedTop).toEqual(['!beta', '!yankee']);

    // Switch Work to Recent activity + showTimes: both Work and inheriting Design Team reorder and showTimes.
    act(() => sectionOf('!work').sort?.onModeChange('recent'));
    act(() => sectionOf('!work').sort?.onShowTimesChange(true));
    expect(sectionOf('!work').mode).toBe('recent');
    expect(sectionOf('!work').showTimes).toBe(true);
    expect(sectionOf('!work').orderedTop).toEqual(['!zebra', '!alpha']);
    expect(sectionOf('!design').mode).toBe('recent');
    expect(sectionOf('!design').showTimes).toBe(true);
    expect(sectionOf('!design').orderedTop).toEqual(['!yankee', '!beta']);
    expect(sectionOf('!design').sort?.inherit?.mode).toBe('recent');

    // Switching Work to manual snapshots both Work and inheriting Design Team atomically.
    setAccountData.mockClear();
    act(() => sectionOf('!work').sort?.onModeChange('manual'));
    expect(setAccountData).toHaveBeenCalledTimes(1);
    expect(sectionOf('!work').mode).toBe('manual');
    expect(sectionOf('!work').orderedTop).toEqual(['!zebra', '!alpha']);
    expect(sectionOf('!design').mode).toBe('manual');
    expect(sectionOf('!design').sort?.inherit?.overridden).toBe(false);
    expect(sectionOf('!design').orderedTop).toEqual(['!yankee', '!beta']);

    // Overriding Design Team to A to Z applies only to Design Team, and resetting restores inheritance.
    act(() => sectionOf('!design').sort?.onModeChange('name'));
    expect(sectionOf('!design').sort?.inherit?.overridden).toBe(true);
    expect(sectionOf('!design').orderedTop).toEqual(['!beta', '!yankee']);
    expect(sectionOf('!work').orderedTop).toEqual(['!zebra', '!alpha']);

    act(() => sectionOf('!design').sort?.inherit?.onReset());
    expect(sectionOf('!design').sort?.inherit?.overridden).toBe(false);
    expect(sectionOf('!design').orderedTop).toEqual(['!yankee', '!beta']);
  });

  it('inherits sort mode only from the displayed parent branch for a diamond-shared sub-space and its descendants', () => {
    const { client } = makeRealClient({
      '!work': { name: 'Work', space: true, createdAt: 100 },
      '!garden': { name: 'Garden', space: true, createdAt: 200 },
      '!design': { name: 'Design Team', space: true, createdAt: 300 },
      '!sketches': { name: 'Sketches', space: true, createdAt: 400 },
      '!alpha': { name: 'Alpha', lastMessageTs: 1000 },
      '!zebra': { name: 'Zebra', lastMessageTs: 5000 },
      '!beta': { name: 'Beta', lastMessageTs: 1000 },
      '!yankee': { name: 'Yankee', lastMessageTs: 6000 },
      '!planning': { name: 'Weekly Planning', lastMessageTs: 2000 },
      '!plants': { name: 'Plant Care', lastMessageTs: 3000 },
    });
    const event = new MatrixEvent({
      type: 'io.mindroom.room_order',
      content: { modes: { '!garden': 'recent' } },
    });
    client.store.storeAccountDataEvents([event]);

    const store = makeStore(
      [
        '!work',
        '!garden',
        '!design',
        '!sketches',
        '!alpha',
        '!zebra',
        '!beta',
        '!yankee',
        '!planning',
        '!plants',
      ],
      {
        '!design': ['!work', '!garden'],
        '!sketches': ['!design'],
        '!alpha': ['!design'],
        '!zebra': ['!design'],
        '!beta': ['!sketches'],
        '!yankee': ['!sketches'],
        '!planning': ['!work'],
        '!plants': ['!garden'],
      }
    );

    const { state } = mount(client, store);
    const design = state.sections.sections.find((section) => section.spaceId === '!design')!;
    const sketches = state.sections.sections.find((section) => section.spaceId === '!sketches')!;

    // Design Team and its descendant Sketches are rendered under Work (default A to Z), so neither
    // may inherit Garden's Recent mode.
    expect(design.ancestorSpaceIds).toEqual(['!work']);
    expect(design.mode).toBe('name');
    expect(design.sort?.inherit?.mode).toBe('name');
    expect(design.orderedTop).toEqual(['!alpha', '!zebra']);
    expect(sketches.ancestorSpaceIds).toEqual(['!design', '!work']);
    expect(sketches.mode).toBe('name');
    expect(sketches.sort?.inherit?.mode).toBe('name');
    expect(sketches.orderedTop).toEqual(['!beta', '!yankee']);
  });
});
