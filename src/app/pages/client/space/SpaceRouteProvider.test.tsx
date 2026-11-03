import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../../hooks/useMatrixClient';
import { useSpace } from '../../../hooks/useSpace';
import { SPACE_PATH } from '../../paths';
import { SpaceRouteProvider } from './Space';

vi.mock('../../../features/join-before-navigate/JoinBeforeNavigate', () => ({
  JoinBeforeNavigate: ({ roomIdOrAlias }: { roomIdOrAlias: string }) => (
    <div data-join-before-navigate={roomIdOrAlias} />
  ),
}));
vi.mock('../../../components/page', () => ({}));
vi.mock('../../../components/nav', () => ({}));
vi.mock('../../../features/room-nav', () => ({}));
vi.mock('../../../mindroom/recent-threads/ThreadNavCategory', () => ({}));
vi.mock('../../../mindroom/recent-threads/RecentlyOpenedNavCategory', () => ({}));
vi.mock('../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem', () => ({}));

const SPACE_ID = '!space:example.org';
const ALIAS = '#team:example.org';

const makeSpace = (canonicalAlias?: string): Room =>
  ({
    roomId: SPACE_ID,
    getMyMembership: () => KnownMembership.Join,
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

const renderRoute = (mx: MatrixClient, path: string): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
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
      </MatrixClientProvider>
    );
  });
  return renderer;
};

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
});
