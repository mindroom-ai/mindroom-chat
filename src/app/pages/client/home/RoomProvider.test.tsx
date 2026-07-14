import React from 'react';
import { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Membership } from '../../../../types/matrix/room';
import { HomeRouteRoomProvider } from './RoomProvider';

const state = vi.hoisted(() => ({
  hasCompletedInitialSync: false,
  isResolvingAlias: false,
  room: undefined as Room | undefined,
  roomIds: [] as string[],
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ roomIdOrAlias: '!room:example.org', eventId: '$event' }),
}));

vi.mock('../../../hooks/router/useSelectedRoom', () => ({
  useSelectedRoomResolution: () => ({
    roomId: '!room:example.org',
    isResolvingAlias: state.isResolvingAlias,
  }),
}));

vi.mock('../../../hooks/router/useSearchParamsViaServers', () => ({
  useSearchParamsViaServers: () => ['example.org'],
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: () => state.room }),
}));

vi.mock('./useHomeRooms', () => ({
  useHomeNavigationRooms: () => ({ roomIds: state.roomIds, spaceIds: [] }),
}));

vi.mock('../ClientStartupContext', () => ({
  useClientStartupContext: () => ({
    hasCompletedInitialSync: state.hasCompletedInitialSync,
  }),
}));

vi.mock('../../../features/join-before-navigate', async () => {
  const reactModule = await import('react');
  return {
    JoinBeforeNavigate: () =>
      reactModule.createElement('span', { 'data-testid': 'join-before-navigate' }),
  };
});

vi.mock('../../../hooks/useRoom', async () => {
  const reactModule = await import('react');
  return {
    RoomProvider: ({ children, value }: { children: React.ReactNode; value: Room }) =>
      reactModule.createElement('section', { 'data-room-id': value.roomId }, children),
    IsDirectRoomProvider: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement(reactModule.Fragment, null, children),
  };
});

const makeRoom = (membership: Membership): Room =>
  ({
    roomId: '!room:example.org',
    getMyMembership: () => membership,
    isSpaceRoom: () => false,
  } as Room);

describe('HomeRouteRoomProvider', () => {
  beforeEach(() => {
    state.hasCompletedInitialSync = false;
    state.isResolvingAlias = false;
    state.room = undefined;
    state.roomIds = [];
  });

  it('defers the join fallback until initial sync completes', () => {
    const renderer = create(
      <HomeRouteRoomProvider>
        <span>Room content</span>
      </HomeRouteRoomProvider>
    );

    expect(renderer.toJSON()).toBeNull();

    state.hasCompletedInitialSync = true;
    act(() => {
      renderer.update(
        <HomeRouteRoomProvider>
          <span>Room content</span>
        </HomeRouteRoomProvider>
      );
    });

    expect(renderer.root.findByProps({ 'data-testid': 'join-before-navigate' })).toBeTruthy();
    act(() => renderer.unmount());
  });

  it('uses Home navigation room IDs to render a routed room', () => {
    state.hasCompletedInitialSync = true;
    state.room = makeRoom(Membership.Invite);
    state.roomIds = [state.room.roomId];
    const renderer = create(
      <HomeRouteRoomProvider>
        <span>Room content</span>
      </HomeRouteRoomProvider>
    );

    expect(renderer.root.findByProps({ 'data-room-id': state.room.roomId })).toBeTruthy();

    state.roomIds = [];
    act(() => {
      renderer.update(
        <HomeRouteRoomProvider>
          <span>Room content</span>
        </HomeRouteRoomProvider>
      );
    });

    expect(renderer.root.findByProps({ 'data-testid': 'join-before-navigate' })).toBeTruthy();
    act(() => renderer.unmount());
  });
});
