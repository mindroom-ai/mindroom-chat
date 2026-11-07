import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { KnownMembership, MatrixClient, MatrixEvent, MemoryStore, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { nestSubRooms, SubRoomRows, useSubRoomList } from './SubRoomRows';

const parents = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([roomId, ids]) => [roomId, new Set(ids)]));

const nest = (
  top: string[],
  shown: string[],
  entries: Record<string, string[]>,
  chatRooms: string[] = []
) => {
  const tree = nestSubRooms(top, shown, parents(entries), new Set(chatRooms));
  return { top: tree.top, children: Object.fromEntries(tree.children) };
};

describe('nestSubRooms', () => {
  it('shows a sub-room under its parent room and not again at top level', () => {
    const rooms = ['!apples', '!bees', '!bees-hives'];

    expect(nest(rooms, rooms, { '!bees-hives': ['!bees'] })).toEqual({
      top: ['!apples', '!bees'],
      children: { '!bees': ['!bees-hives'] },
    });
  });

  it('nests a sub-room of a sub-room under it', () => {
    const rooms = ['!a', '!a-sub', '!a-sub-sub'];

    expect(nest(rooms, rooms, { '!a-sub': ['!a'], '!a-sub-sub': ['!a-sub'] })).toEqual({
      top: ['!a'],
      children: { '!a': ['!a-sub'], '!a-sub': ['!a-sub-sub'] },
    });
  });

  it('shows a sub-room at top level, in its place, while its parent room is not in the section', () => {
    const rooms = ['!sub', '!zebra'];

    expect(nest(rooms, rooms, { '!sub': ['!archived-parent'] })).toEqual({
      top: ['!sub', '!zebra'],
      children: {},
    });
  });

  it("takes a space's sub-rooms from its rooms at any depth, under its own rooms only", () => {
    const own = ['!own'];
    const anyDepth = ['!own', '!own-sub', '!subspace-room', '!subspace-room-sub'];

    expect(
      nest(
        own,
        anyDepth,
        {
          '!own': ['!space'],
          '!own-sub': ['!own'],
          '!subspace-room': ['!subspace'],
          '!subspace-room-sub': ['!subspace-room'],
        },
        ['!own', '!subspace-room']
      )
    ).toEqual({ top: ['!own'], children: { '!own': ['!own-sub'] } });
  });

  it("shows a space's sub-room at top level while the room it sits under is hidden, also when another space lists it", () => {
    const own = ['!own'];
    const anyDepth = ['!archived-own-sub', '!own', '!subspace-room'];

    expect(
      nest(
        own,
        anyDepth,
        {
          '!own': ['!space'],
          '!archived-own-sub': ['!archived-own', '!other-space'],
          '!archived-own': ['!space'],
          '!subspace-room': ['!subspace'],
        },
        ['!archived-own']
      )
    ).toEqual({ top: ['!archived-own-sub', '!own'], children: {} });
  });

  it('keeps a room of the space in its place when it is also a sub-room of a subspace room', () => {
    const own = ['!a', '!b', '!c'];
    const anyDepth = ['!a', '!b', '!c', '!subspace-room'];

    expect(
      nest(own, anyDepth, {
        '!b': ['!space', '!subspace-room'],
        '!subspace-room': ['!subspace'],
      })
    ).toEqual({ top: ['!a', '!b', '!c'], children: {} });
  });

  it('shows a room listed by two rooms of the section once, under the first', () => {
    const rooms = ['!a', '!b', '!shared'];

    expect(nest(rooms, rooms, { '!shared': ['!b', '!a'] })).toEqual({
      top: ['!a', '!b'],
      children: { '!a': ['!shared'] },
    });
  });

  it('keeps rooms that list each other in a loop in the section', () => {
    const rooms = ['!a', '!b'];

    expect(nest(rooms, rooms, { '!a': ['!b'], '!b': ['!a'] })).toEqual({
      top: ['!a'],
      children: { '!a': ['!b'] },
    });
  });
});

describe('SubRoomRows', () => {
  const ME = '@me:example.org';
  const PARENT = '!parent:example.org';
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const child = (stateKey: string, via: string[]) =>
    new MatrixEvent({
      type: 'm.space.child',
      state_key: stateKey,
      sender: ME,
      room_id: PARENT,
      event_id: `$${stateKey}`,
      content: { via },
    });

  it('shows the joined sub-rooms, then the listed rooms the user has not joined, to join', async () => {
    const mx = new MatrixClient({
      baseUrl: 'https://example.org',
      userId: ME,
      store: new MemoryStore(),
    });
    const room = (roomId: string, membership: string, space = false) => {
      const made = new Room(roomId, mx, ME);
      if (space) {
        made.currentState.setStateEvents([
          new MatrixEvent({
            type: 'm.room.create',
            state_key: '',
            sender: ME,
            room_id: roomId,
            event_id: `$${roomId}-create`,
            content: { type: 'm.space' },
          }),
        ]);
      }
      made.updateMyMembership(membership);
      mx.store.storeRoom(made);
      return made;
    };
    const parent = room(PARENT, KnownMembership.Join);
    room('!joined:example.org', KnownMembership.Join);
    room('!joined-elsewhere:example.org', KnownMembership.Join);
    room('!left:example.org', KnownMembership.Leave);
    room('!space:example.org', KnownMembership.Leave, true);
    parent.currentState.setStateEvents([
      child('!joined:example.org', ['example.org']),
      child('!joined-elsewhere:example.org', ['example.org']),
      child('!left:example.org', ['example.org']),
      child('!unknown:remote.org', ['remote.org']),
      child('!space:example.org', ['example.org']),
      child('!unlisted:example.org', []),
      child('#alias:example.org', ['example.org']),
    ]);
    vi.spyOn(mx, 'getRoomSummary').mockImplementation(async (roomId: string) => ({
      room_id: roomId,
      name: `Name of ${roomId}`,
      num_joined_members: 1,
      world_readable: false,
      guest_can_join: false,
    }));
    const tree = { top: [PARENT], children: new Map([[PARENT, ['!joined:example.org']]]) };

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={new QueryClient()}>
          <MatrixClientProvider value={mx}>
            <MemoryRouter>
              <SubRoomRows
                parent={parent}
                tree={tree}
                renderRoom={(shown) => <div data-room-row={shown.roomId} />}
                previewPath={(roomId) => `/preview/${roomId}`}
              />
            </MemoryRouter>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    const root = renderer!.root;
    const marked = (attribute: string) =>
      root
        .findAll((node) => typeof node.type === 'string' && attribute in node.props)
        .map((node) => node.props[attribute] as string);
    expect(marked('data-room-row')).toEqual(['!joined:example.org']);
    expect(marked('data-sub-room-to-join')).toEqual(['!left:example.org', '!unknown:remote.org']);
    expect(root.findAll((node) => node.type === 'a').map((node) => node.props.href)).toEqual([
      '/preview/!left:example.org?viaServers=example.org',
      '/preview/!unknown:remote.org?viaServers=remote.org',
    ]);
    await vi.waitFor(() =>
      expect(JSON.stringify(renderer!.toJSON())).toContain('Name of !unknown:remote.org')
    );
  });
});

describe('useSubRoomList', () => {
  const ME = '@me:example.org';
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  /** The list of a space whose own room `!a` has the sub-room `!a-sub`, beside a subspace's room. */
  const listOf = (closed: boolean, selectedRoomId?: string) => {
    const store = createStore();
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: parents({ '!a': ['!space'], '!a-sub': ['!a'], '!other': ['!subspace'] }),
      chatRooms: ['!a'],
    });
    const mx = new MatrixClient({
      baseUrl: 'https://example.org',
      userId: ME,
      store: new MemoryStore(),
    });
    let list: ReturnType<typeof useSubRoomList> | undefined;
    const Harness = () => {
      list = useSubRoomList(
        '!space',
        ['!a'],
        ['!a', '!a-sub', '!other'],
        closed,
        selectedRoomId,
        (id) => id
      );
      return null;
    };
    act(() => {
      renderer = create(
        <Provider store={store}>
          <MatrixClientProvider value={mx}>
            <MemoryRouter>
              <Harness />
            </MemoryRouter>
          </MatrixClientProvider>
        </Provider>
      );
    });
    return list!;
  };

  it("lists the section's own rooms, each with its sub-rooms under it", () => {
    const { listedRoomIds, tree } = listOf(false);

    expect(listedRoomIds).toEqual(['!a']);
    expect(Object.fromEntries(tree.children)).toEqual({ '!a': ['!a-sub'] });
  });

  it('lists only the selected room, a sub-room too, while the section is collapsed', () => {
    expect(listOf(true, '!a-sub').listedRoomIds).toEqual(['!a-sub']);
  });
});
