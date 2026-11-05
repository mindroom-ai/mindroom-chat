import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { useRoom } from '../matrix/hooks/useRoom';
import { allRoomsAtom } from '../matrix/state/roomList';
import { HOME_ROOM_PATH, SPACE_PATH } from '../routes/paths';
import { ClientStartupProvider } from '../matrix/ClientStartupContext';
import { RoomRoute } from './RoomRoute';

vi.mock('../rooms/join/JoinBeforeNavigate', () => ({
  JoinBeforeNavigate: ({ roomIdOrAlias }: { roomIdOrAlias: string }) => (
    <div data-join-before-navigate={roomIdOrAlias} />
  ),
}));

const ROOM_ID = '!room:example.org';
const ALIAS = '#lobby:example.org';

const makeRoom = (canonicalAlias?: string, membership = (): string => KnownMembership.Join): Room =>
  ({
    roomId: ROOM_ID,
    getMyMembership: membership,
    getCanonicalAlias: () => canonicalAlias ?? null,
    getAltAliases: () => [],
    isSpaceRoom: () => false,
  } as unknown as Room);

const makeClient = (rooms: Room[], getRoomIdForAlias = vi.fn()): MatrixClient =>
  ({
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
    getRooms: () => rooms,
    getRoomIdForAlias,
  } as unknown as MatrixClient);

function ShownRoom() {
  return <div data-shown-room={useRoom().roomId} />;
}

function SpaceLanding() {
  return <div data-space-path={useLocation().pathname} />;
}

const renderRoute = (
  mx: MatrixClient,
  path: string,
  { synced = true, store = createStore() } = {}
): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <ClientStartupProvider hasCompletedInitialSync={synced}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route
                  path={HOME_ROOM_PATH}
                  element={
                    <RoomRoute>
                      <ShownRoom />
                    </RoomRoute>
                  }
                />
                <Route path={SPACE_PATH} element={<SpaceLanding />} />
              </Routes>
            </MemoryRouter>
          </ClientStartupProvider>
        </MatrixClientProvider>
      </JotaiProvider>
    );
  });
  return renderer;
};

const joinOffers = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => node.props['data-join-before-navigate'] !== undefined)
    .map((node) => node.props['data-join-before-navigate']);

const shownRoom = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-shown-room'] !== undefined)[0]?.props[
    'data-shown-room'
  ];

describe('RoomRoute', () => {
  it('sends a joined space opened by a room address to its space page', () => {
    const space = { ...makeRoom(), isSpaceRoom: () => true } as unknown as Room;
    const renderer = renderRoute(makeClient([space]), `/home/${encodeURIComponent(ROOM_ID)}/`);
    expect(shownRoom(renderer)).toBeUndefined();
    expect(
      renderer.root.findAll((node) => node.props['data-space-path'] !== undefined)[0]?.props[
        'data-space-path'
      ]
    ).toMatch(new RegExp(`^/${encodeURIComponent(ROOM_ID)}/?$`));
  });

  it('opens a joined room from its known canonical alias', () => {
    const renderer = renderRoute(
      makeClient([makeRoom(ALIAS)]),
      `/home/${encodeURIComponent(ALIAS)}/`
    );
    expect(shownRoom(renderer)).toBe(ROOM_ID);
  });

  it('waits for the server to resolve an unknown alias, then opens the joined room', async () => {
    let resolveAlias!: (value: { room_id: string }) => void;
    const getRoomIdForAlias = vi.fn(
      () =>
        new Promise<{ room_id: string }>((resolve) => {
          resolveAlias = resolve;
        })
    );
    const renderer = renderRoute(
      makeClient([makeRoom()], getRoomIdForAlias),
      `/home/${encodeURIComponent(ALIAS)}/`
    );
    expect(getRoomIdForAlias).toHaveBeenCalledWith(ALIAS);
    expect(shownRoom(renderer)).toBeUndefined();
    expect(
      renderer.root.findAll((node) => node.props['data-join-before-navigate'] !== undefined)
    ).toHaveLength(0);

    await act(async () => {
      resolveAlias({ room_id: ROOM_ID });
    });
    expect(shownRoom(renderer)).toBe(ROOM_ID);
  });

  it('offers to join a room the user is not in', () => {
    const renderer = renderRoute(
      makeClient([]),
      `/home/${encodeURIComponent('!other:example.org')}/`
    );
    expect(
      renderer.root.findByProps({ 'data-join-before-navigate': '!other:example.org' })
    ).toBeDefined();
  });

  it('waits for the first sync before offering to join a room it does not know', () => {
    const renderer = renderRoute(
      makeClient([]),
      `/home/${encodeURIComponent('!other:example.org')}/`,
      { synced: false }
    );
    expect(joinOffers(renderer)).toEqual([]);
    expect(shownRoom(renderer)).toBeUndefined();
  });

  it('opens the room as soon as the join lands, without another click', () => {
    let membership: string = KnownMembership.Leave;
    const store = createStore();
    const renderer = renderRoute(
      makeClient([makeRoom(undefined, () => membership)]),
      `/home/${encodeURIComponent(ROOM_ID)}/`,
      { store }
    );
    expect(joinOffers(renderer)).toEqual([ROOM_ID]);

    act(() => {
      membership = KnownMembership.Join;
      store.set(allRoomsAtom, { type: 'PUT', roomId: ROOM_ID });
    });
    expect(shownRoom(renderer)).toBe(ROOM_ID);
    expect(joinOffers(renderer)).toEqual([]);
  });

  it('keeps a room segment that is not valid percent-encoding instead of crashing', () => {
    const renderer = renderRoute(makeClient([]), '/home/%25zz/');
    expect(joinOffers(renderer)).toEqual(['%zz']);
  });
});
