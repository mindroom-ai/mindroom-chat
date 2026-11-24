import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, atom, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import type { RoomToParents } from '../../matrix/types/room';
import { StateEvent } from '../../matrix/types/room';
import { matchesEnum } from '../../lib/matchesEnum';
import type { ClosedNavCategoriesAtom } from '../../ui/nav/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../ui/nav/useClosedNavCategories';
import { useSpaceRoomSections } from './SpaceRoomSection';

type RoomFixture = { name: string; space?: boolean; lastActive?: number };

const makeRoom = (roomId: string, entry: RoomFixture) => ({
  roomId,
  name: entry.name,
  isSpaceRoom: () => Boolean(entry.space),
  getMyMembership: () => 'join',
  getLastActiveTimestamp: () => entry.lastActive ?? 0,
  getThreads: () => [],
  getLiveTimeline: () => ({
    getEvents: () => [],
    getState: () => ({
      getStateEvents: (type: string) =>
        matchesEnum(type, StateEvent.RoomCreate)
          ? {
              getContent: () => (entry.space ? { type: 'm.space' } : {}),
              getSender: () => '@alice:example.org',
            }
          : undefined,
    }),
  }),
});

describe('useSpaceRoomSections inherited Custom snapshot', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('freezes inheriting sub-space Recent order on first switch to Custom and keeps parent inheritance', () => {
    const rooms: Record<string, RoomFixture> = {
      '!root': { name: 'Root', space: true },
      '!sub': { name: 'Sub', space: true },
      '!alder': { name: 'Alder', lastActive: 1000 },
      '!zebra': { name: 'Zebra', lastActive: 5000 },
      '!overridden': { name: 'Overridden', space: true },
      '!oak': { name: 'Oak', lastActive: 2000 },
      '!shadowed': { name: 'Shadowed', space: true },
      '!elm': { name: 'Elm', lastActive: 1000 },
      '!yew': { name: 'Yew', lastActive: 6000 },
      '!savedSub': { name: 'SavedSub', space: true },
      '!cedar': { name: 'Cedar', lastActive: 1000 },
      '!pine': { name: 'Pine', lastActive: 7000 },
    };

    const initialAccountData = {
      lists: { '!savedSub': ['!pine', '!cedar'] },
      modes: { '!root': 'recent', '!overridden': 'name', '!savedSub': 'inherit' },
    };
    const event = { getContent: () => initialAccountData } as unknown as MatrixEvent;
    const setAccountData = vi.fn(async () => ({}));
    const roomMap = new Map(Object.entries(rooms).map(([id, entry]) => [id, makeRoom(id, entry)]));
    const client = {
      getSafeUserId: () => '@alice:example.org',
      getRoom: (roomId: string) => roomMap.get(roomId) ?? null,
      getAccountData: (type: string) => (type === 'io.mindroom.room_order' ? event : undefined),
      setAccountData,
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;

    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: Object.keys(rooms) });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    const parents: RoomToParents = new Map(
      Object.entries({
        '!sub': ['!root'],
        '!alder': ['!sub'],
        '!zebra': ['!sub'],
        '!overridden': ['!root'],
        '!oak': ['!overridden'],
        '!shadowed': ['!overridden'],
        '!elm': ['!shadowed'],
        '!yew': ['!shadowed'],
        '!savedSub': ['!root'],
        '!cedar': ['!savedSub'],
        '!pine': ['!savedSub'],
      }).map(([id, list]) => [id, new Set(list)])
    );
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: parents,
      chatRooms: [],
    });
    const closedCategoriesAtom: ClosedNavCategoriesAtom = atom(
      () => new Set<string>(),
      () => {
        // Categories stay expanded in this test.
      }
    );

    let latest!: ReturnType<typeof useSpaceRoomSections>;
    const Harness = () => {
      latest = useSpaceRoomSections('!root', undefined);
      return null;
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <MatrixClientProvider value={client}>
            <ClosedNavCategoriesProvider value={closedCategoriesAtom}>
              <Harness />
            </ClosedNavCategoriesProvider>
          </MatrixClientProvider>
        </Provider>
      );
    });

    const sectionOf = (spaceId: string) =>
      latest.sections.find((section) => section.spaceId === spaceId)!;

    // Root is empty; inheriting !sub shows [Zebra, Alder] in Recent mode.
    expect(sectionOf('!root').orderedTop).toEqual([]);
    expect(sectionOf('!sub').orderedTop).toEqual(['!zebra', '!alder']);
    expect(sectionOf('!sub').sort?.overridden).toBe(false);

    // Switching root to Custom freezes !sub's [Zebra, Alder] with mode "inherit" in one write,
    // without touching !overridden, !shadowed (inherits from !overridden), or !savedSub.
    act(() => latest.sort.setMode('manual'));
    expect(setAccountData).toHaveBeenCalledTimes(1);
    expect(setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!savedSub': ['!pine', '!cedar'], '!sub': ['!zebra', '!alder'] },
      modes: {
        '!root': 'manual',
        '!overridden': 'name',
        '!savedSub': 'inherit',
        '!sub': 'inherit',
      },
    });
    expect(sectionOf('!sub').mode).toBe('manual');
    expect(sectionOf('!sub').sort?.overridden).toBe(false);
    expect(sectionOf('!sub').orderedTop).toEqual(['!zebra', '!alder']);

    // Switching root back to A to Z and Recent still carries down to !sub.
    act(() => latest.sort.setMode('name'));
    expect(sectionOf('!sub').mode).toBe('name');
    expect(sectionOf('!sub').orderedTop).toEqual(['!alder', '!zebra']);

    act(() => latest.sort.setMode('recent'));
    expect(sectionOf('!sub').mode).toBe('recent');
    expect(sectionOf('!sub').orderedTop).toEqual(['!zebra', '!alder']);

    // Switching root back to Custom restores the preserved [Zebra, Alder] order.
    act(() => latest.sort.setMode('manual'));
    expect(sectionOf('!sub').mode).toBe('manual');
    expect(sectionOf('!sub').orderedTop).toEqual(['!zebra', '!alder']);
  });
});
