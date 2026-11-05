import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { useSpace } from '../../matrix/hooks/useSpace';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { ROOT_PATH, SPACE_PATH } from '../../routes/paths';
import { ClientStartupProvider } from '../../matrix/ClientStartupContext';
import { SpaceRouteProvider } from './Space';

vi.mock('../../rooms/join/JoinBeforeNavigate', () => ({
  JoinBeforeNavigate: ({ roomIdOrAlias }: { roomIdOrAlias: string }) => (
    <div data-join-before-navigate={roomIdOrAlias} />
  ),
}));
vi.mock('../../ui/page/Page', () => ({}));
vi.mock('../../ui/page/PageScroll', () => ({}));
vi.mock('../../ui/nav/NavItem', () => ({}));
vi.mock('../../ui/nav/NavCategoryHeader', () => ({}));
vi.mock('../room-nav/RoomNavCategoryButton', () => ({}));
vi.mock('../room-nav/RoomNavItem', () => ({}));
vi.mock('../threads/ThreadNavCategory', () => ({}));
vi.mock('../threads/RecentlyOpenedNavCategory', () => ({}));
vi.mock('../../notifications/MarkRoomsReadMenuItem', () => ({}));

const SPACE_ID = '!space:example.org';
const ALIAS = '#team:example.org';

const makeSpace = (
  canonicalAlias?: string,
  membership = (): string => KnownMembership.Join
): Room =>
  ({
    roomId: SPACE_ID,
    getMyMembership: membership,
    isSpaceRoom: () => true,
    getCanonicalAlias: () => canonicalAlias ?? null,
    getAltAliases: () => [],
  } as unknown as Room);

const makeClient = (rooms: Room[], getRoomIdForAlias = vi.fn()): MatrixClient =>
  ({
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
    getRooms: () => rooms,
    getRoomIdForAlias,
  } as unknown as MatrixClient);

function ShownSpace() {
  return <div data-shown-space={useSpace().roomId} />;
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
                <Route path={ROOT_PATH} element={<div data-root />} />
                <Route
                  path={SPACE_PATH}
                  element={
                    <SpaceRouteProvider>
                      <ShownSpace />
                    </SpaceRouteProvider>
                  }
                />
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

const shownSpace = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-shown-space'] !== undefined)[0]?.props[
    'data-shown-space'
  ];

describe('SpaceRouteProvider', () => {
  it('opens a joined space from its known canonical alias', () => {
    const renderer = renderRoute(makeClient([makeSpace(ALIAS)]), `/${encodeURIComponent(ALIAS)}/`);
    expect(shownSpace(renderer)).toBe(SPACE_ID);
  });

  it('waits for the server to resolve an unknown alias, then opens the joined space', async () => {
    let resolveAlias!: (value: { room_id: string }) => void;
    const getRoomIdForAlias = vi.fn(
      () =>
        new Promise<{ room_id: string }>((resolve) => {
          resolveAlias = resolve;
        })
    );
    const renderer = renderRoute(
      makeClient([makeSpace()], getRoomIdForAlias),
      `/${encodeURIComponent(ALIAS)}/`
    );
    expect(getRoomIdForAlias).toHaveBeenCalledWith(ALIAS);
    expect(shownSpace(renderer)).toBeUndefined();
    expect(
      renderer.root.findAll((node) => node.props['data-join-before-navigate'] !== undefined)
    ).toHaveLength(0);

    await act(async () => {
      resolveAlias({ room_id: SPACE_ID });
    });
    expect(shownSpace(renderer)).toBe(SPACE_ID);
  });

  it('offers to join a space the user is not in', () => {
    const renderer = renderRoute(makeClient([]), `/${encodeURIComponent('!other:example.org')}/`);
    expect(
      renderer.root.findByProps({ 'data-join-before-navigate': '!other:example.org' })
    ).toBeDefined();
  });

  it('opens the space as soon as the join lands, without another click', () => {
    let membership: string = KnownMembership.Leave;
    const store = createStore();
    const renderer = renderRoute(
      makeClient([makeSpace(undefined, () => membership)]),
      `/${encodeURIComponent(SPACE_ID)}/`,
      { store }
    );
    expect(joinOffers(renderer)).toEqual([SPACE_ID]);

    act(() => {
      membership = KnownMembership.Join;
      store.set(allRoomsAtom, { type: 'PUT', roomId: SPACE_ID });
    });
    expect(shownSpace(renderer)).toBe(SPACE_ID);
  });

  it('waits for the first sync before offering to join a space it does not know', () => {
    const renderer = renderRoute(makeClient([]), `/${encodeURIComponent('!other:example.org')}/`, {
      synced: false,
    });
    expect(joinOffers(renderer)).toEqual([]);
  });

  it('sends a first segment that is no room ID or alias to the root', () => {
    const renderer = renderRoute(makeClient([]), '/not-a-room/');
    expect(renderer.root.findAll((node) => node.props['data-root'] !== undefined)).toHaveLength(1);
    expect(joinOffers(renderer)).toEqual([]);
  });

  it('keeps a space segment that is not valid percent-encoding instead of crashing', () => {
    const renderer = renderRoute(makeClient([]), '/!%25zz/');
    expect(joinOffers(renderer)).toEqual(['!%zz']);
  });
});
