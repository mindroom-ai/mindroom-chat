import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { HOME_ROOM_PATH } from '../paths';
import { RoomRoute } from './RoomRoute';

vi.mock('../../features/join-before-navigate/JoinBeforeNavigate', () => ({
  JoinBeforeNavigate: ({ roomIdOrAlias }: { roomIdOrAlias: string }) => (
    <div data-join-before-navigate={roomIdOrAlias} />
  ),
}));

const ROOM_ID = '!room:example.org';
const ALIAS = '#lobby:example.org';

const makeRoom = (canonicalAlias?: string): Room =>
  ({
    roomId: ROOM_ID,
    getMyMembership: () => KnownMembership.Join,
    getCanonicalAlias: () => canonicalAlias ?? null,
    getAltAliases: () => [],
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

const renderRoute = (mx: MatrixClient, path: string): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MatrixClientProvider value={mx}>
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
          </Routes>
        </MemoryRouter>
      </MatrixClientProvider>
    );
  });
  return renderer;
};

const shownRoom = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-shown-room'] !== undefined)[0]?.props[
    'data-shown-room'
  ];

describe('RoomRoute', () => {
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
});
