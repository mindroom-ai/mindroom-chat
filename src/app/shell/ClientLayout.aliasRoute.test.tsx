// @vitest-environment jsdom

import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { JoinRule, KnownMembership, type Room } from 'matrix-js-sdk';
import {
  createBrowserRouter,
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  type Location,
} from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientStartupProvider } from '../matrix/ClientStartupContext';
import { RoomRoute } from '../room/RoomRoute';
import { SpaceRouteProvider } from '../sidebar/space/Space';
import { ClientLayout } from './ClientLayout';
import { putSession } from '../matrix/session/sessions';
import { isReturnToRoom, RETURN_TO_ROOM_STATE } from '../routes/historyStack';
import { HOME_ROOM_PATH, SPACE_PATH, SPACE_ROOM_PATH } from '../routes/paths';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';

// The notice places are tested in ui/noticeSlots.test.tsx.
vi.mock('../ui/noticeSlots', () => ({ NoticeSlot: () => null }));
vi.mock('../ui/page/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => children,
  PageHeader: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));
vi.mock('../rooms/RoomCard.css', () => ({
  ActionButton: 'ActionButton',
  CardGrid: 'CardGrid',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    ...actual,
    Overlay: ({
      open,
      children,
      backdrop,
    }: {
      open?: boolean;
      children?: React.ReactNode;
      backdrop?: React.ReactNode;
    }) => (open ? React.createElement(React.Fragment, null, backdrop, children) : null),
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Scroll: Wrapper,
  };
});

const defaultRoom = {
  roomId: '!room:example.org',
  getMyMembership: () => KnownMembership.Join,
  getCanonicalAlias: () => '#room:example.org',
  getAltAliases: () => [],
  isSpaceRoom: () => false,
} as unknown as Room;

const mockClientState = vi.hoisted(() => ({
  rooms: [] as Room[],
  getRoomIdForAlias: vi.fn(),
  getRoomSummary: vi.fn(),
  joinRoom: vi.fn(),
  leave: vi.fn(),
}));

const clientStub = {
  getRooms: () => mockClientState.rooms,
  getRoom: (roomId: string) => mockClientState.rooms.find((room) => room.roomId === roomId) ?? null,
  getRoomIdForAlias: mockClientState.getRoomIdForAlias,
  getRoomSummary: mockClientState.getRoomSummary,
  joinRoom: mockClientState.joinRoom,
  leave: mockClientState.leave,
  getSafeUserId: () => '@alice:example.org',
  getSyncState: () => 'SYNCING',
  on: vi.fn(),
  removeListener: vi.fn(),
};

mockClientState.rooms = [defaultRoom];

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => clientStub,
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../matrix/session/useSessionStore', async () => {
  const sessions = await import('../matrix/session/sessions');
  return { useActiveSession: () => sessions.getActiveSession() };
});

const { getRoomIdForAlias } = mockClientState;

followRouterSignalsInNode();
afterEach(() => {
  localStorage.clear();
  mockClientState.rooms = [defaultRoom];
  mockClientState.getRoomIdForAlias.mockReset();
  mockClientState.getRoomSummary.mockReset();
  mockClientState.joinRoom.mockReset();
  mockClientState.leave.mockReset();
});

describe('ClientLayout with an alias the client knows', () => {
  it('keeps the page mounted while the room ID route replaces the address', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    const mounted = { count: 0, unmounted: 0 };
    let navigate: ReturnType<typeof useNavigate> | undefined;
    let location: Location | undefined;
    const Page = () => {
      useEffect(() => {
        mounted.count += 1;
        return () => {
          mounted.unmounted += 1;
        };
      }, []);
      return null;
    };
    const Probe = () => {
      navigate = useNavigate();
      location = useLocation();
      return null;
    };
    await act(async () => {
      create(
        <MemoryRouter initialEntries={['/home/!room%3Aexample.org']}>
          <Probe />
          <ClientLayout nav={null}>
            <Page />
          </ClientLayout>
        </MemoryRouter>
      );
    });
    expect(mounted.count).toBe(1);

    // A thread link the app built names the room by its alias.
    await act(async () => {
      void navigate?.('/home/%23room%3Aexample.org?threadId=%24root');
      await Promise.resolve();
    });

    expect(location?.pathname).toBe('/home/!room%3Aexample.org');
    expect(location?.search).toBe('?threadId=%24root');
    expect(mounted).toEqual({ count: 1, unmounted: 0 });
    expect(getRoomIdForAlias).not.toHaveBeenCalled();
  });
});

describe('ClientLayout with a data router whose page shows a new location late', () => {
  const signIn = () =>
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

  /**
   * The app's routes in a browser router, and the router the page is given: it shows the
   * router's latest location a moment after the router has it, so the locations of the moment
   * between are never shown.
   */
  const mount = async (page: React.ReactElement) => {
    const router = createBrowserRouter([
      {
        element: (
          <ClientLayout nav={null}>
            <Outlet />
          </ClientLayout>
        ),
        children: [{ path: '/home/:roomIdOrAlias/:eventId?', element: page }],
      },
    ]);
    const lagging = Object.create(router, {
      subscribe: {
        value: (listener: Parameters<typeof router.subscribe>[0]) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return router.subscribe((state, opts) => {
            clearTimeout(timer);
            timer = setTimeout(() => listener(state, opts), 20);
          });
        },
      },
    }) as typeof router;
    await act(async () => {
      create(<RouterProvider router={lagging} />);
      await settle();
    });
    return router;
  };

  it("leaves the address of a redirect made before the alias route's replacement", async () => {
    signIn();
    window.history.replaceState(null, '', '/home/!room%3Aexample.org?threadId=%24source');
    // The room page redirects a link to a thread's root into the thread, in place of the link,
    // in the same commit that shows the link's address; the same event's route again (the room
    // ID route of the link) is the open it handled (timeline/roomEventOpenController.ts).
    let redirects = 0;
    const RoomPage = () => {
      const navigate = useNavigate();
      const { eventId } = useParams();
      useEffect(() => {
        if (eventId !== '$root' || redirects > 0) return;
        redirects += 1;
        void navigate('/home/%23room%3Aexample.org?threadId=%24root', { replace: true });
      }, [navigate, eventId]);
      return null;
    };
    const router = await mount(<RoomPage />);

    // A link names the room by its alias.
    await act(async () => {
      await router.navigate('/home/%23room%3Aexample.org/%24root');
      await settle();
    });
    await act(settle);

    expect(router.state.location.pathname).toBe('/home/!room%3Aexample.org');
    expect(router.state.location.search).toBe('?threadId=%24root');
    router.dispose();
  });

  it('keeps the address of the first entry a step back returns to while an alias is looked up', async () => {
    signIn();
    let answer: (value: { room_id: string }) => void = () => undefined;
    getRoomIdForAlias.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    // The entry the page load started on, which the router wrote no key for.
    window.history.replaceState(null, '', '/home/!room%3Aexample.org');
    const router = await mount(<div />);
    expect(router.state.location.key).toBe('default');

    // An alias the client does not know: the homeserver's directory is asked.
    await act(async () => {
      await router.navigate('/home/%23other%3Aexample.org');
      await settle();
    });
    expect(getRoomIdForAlias).toHaveBeenCalledWith('#other:example.org');

    await act(async () => {
      await router.navigate(-1);
      for (let tick = 0; tick < 10 && router.state.location.key !== 'default'; tick += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(router.state.location.key).toBe('default');
      // The answer comes before the page shows the step back.
      answer({ room_id: '!other:example.org' });
      await settle();
    });
    await act(settle);

    expect(router.state.location.pathname).toBe('/home/!room%3Aexample.org');
    expect(window.location.pathname).toBe('/home/!room%3Aexample.org');
    router.dispose();
  });

  it('replaces the alias route the page load starts on with the room ID route', async () => {
    signIn();
    getRoomIdForAlias.mockResolvedValue({ room_id: '!other:example.org' });
    window.history.replaceState(null, '', '/home/%23other%3Aexample.org?threadId=%24root');
    const router = await mount(<div />);
    await act(settle);

    expect(router.state.location.pathname).toBe('/home/!other%3Aexample.org');
    expect(router.state.location.search).toBe('?threadId=%24root');
    router.dispose();
  });

  it('keeps what the entry says of its visit: the room the app’s Back returned to', async () => {
    signIn();
    getRoomIdForAlias.mockResolvedValue({ room_id: '!other:example.org' });
    window.history.replaceState(
      { usr: RETURN_TO_ROOM_STATE, key: 'returned', idx: 0 },
      '',
      '/home/%23other%3Aexample.org/%24event'
    );
    const router = await mount(<div />);
    await act(settle);

    expect(router.state.location.pathname).toBe('/home/!other%3Aexample.org/%24event');
    expect(isReturnToRoom(router.state.location.state)).toBe(true);
    router.dispose();
  });
});

describe('ClientLayout + RoomRoute + JoinBeforeNavigate alias handoff', () => {
  const signIn = () =>
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });

  const flush = async () => {
    for (let tick = 0; tick < 6; tick += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  const renderWithRoomRoute = async (initialEntry: string) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const store = createStore();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <JotaiProvider store={store}>
            <ClientStartupProvider hasCompletedInitialSync>
              <MemoryRouter initialEntries={[initialEntry]}>
                <ClientLayout nav={null}>
                  <Routes>
                    <Route
                      path={HOME_ROOM_PATH}
                      element={
                        <RoomRoute>
                          <div data-joined-room />
                        </RoomRoute>
                      }
                    />
                    <Route
                      path={SPACE_PATH}
                      element={
                        <SpaceRouteProvider>
                          <Outlet />
                        </SpaceRouteProvider>
                      }
                    >
                      <Route
                        path={SPACE_ROOM_PATH}
                        element={
                          <RoomRoute>
                            <div data-joined-room />
                          </RoomRoute>
                        }
                      />
                    </Route>
                  </Routes>
                </ClientLayout>
              </MemoryRouter>
            </ClientStartupProvider>
          </JotaiProvider>
        </QueryClientProvider>
      );
      await flush();
    });
    return { renderer, queryClient };
  };

  const textOf = (node: unknown): string =>
    typeof node === 'string'
      ? node
      : ((node as { children?: unknown[] }).children ?? []).map(textOf).join('');

  it('passes directory servers to getRoomSummary and joinRoom for an unjoined remote alias', async () => {
    signIn();
    mockClientState.getRoomIdForAlias.mockResolvedValue({
      room_id: '!remote:other.example.org',
      servers: ['other.example.org'],
    });
    mockClientState.getRoomSummary.mockResolvedValue({
      room_id: '!remote:other.example.org',
      name: 'Field notes',
      topic: 'Ridge readings',
      join_rule: JoinRule.Public,
      num_joined_members: 4,
    });
    mockClientState.joinRoom.mockResolvedValue({ roomId: '!remote:other.example.org' });

    const { renderer, queryClient } = await renderWithRoomRoute(
      '/home/%23remote%3Aother.example.org'
    );

    expect(mockClientState.getRoomIdForAlias).toHaveBeenCalledWith('#remote:other.example.org');
    expect(mockClientState.getRoomSummary).toHaveBeenCalledWith('!remote:other.example.org', [
      'other.example.org',
    ]);

    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => textOf(button) === 'Join');
    expect(joinButton).toBeDefined();

    await act(async () => {
      (joinButton?.props.onClick as () => void)?.();
      await flush();
    });

    expect(mockClientState.joinRoom).toHaveBeenCalledWith('!remote:other.example.org', {
      viaServers: ['other.example.org'],
    });

    act(() => renderer.unmount());
    queryClient.clear();
  });

  it('shows cached invite Join and Decline controls when directory and summary lookups fail for a stale alt alias', async () => {
    signIn();
    const inviteState = new Map<string, { getContent: () => Record<string, unknown> }>([
      ['m.room.topic', { getContent: () => ({ topic: 'Harbor invite notes' }) }],
    ]);
    const invitedRoom = {
      roomId: '!invited-desk:example.org',
      name: 'Harbor invite',
      myUserId: '@alice:example.org',
      getMyMembership: () => KnownMembership.Invite,
      getCanonicalAlias: () => null,
      getAltAliases: () => ['#stale-alt:example.org'],
      isSpaceRoom: () => false,
      getLiveTimeline: () => ({
        getState: () => ({ getStateEvents: (type: string) => inviteState.get(type) }),
      }),
      getMxcAvatarUrl: () => null,
      getJoinedMemberCount: () => 0,
      getType: () => undefined,
      getJoinRule: () => JoinRule.Invite,
      getMember: (userId: string) =>
        userId === '@alice:example.org'
          ? { events: { member: { getSender: () => '@host:example.org' } } }
          : { name: 'Harbor Host' },
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as Room;
    mockClientState.rooms = [defaultRoom, invitedRoom];
    mockClientState.getRoomIdForAlias.mockRejectedValue(new Error('M_NOT_FOUND'));
    mockClientState.getRoomSummary.mockRejectedValue(new Error('M_FORBIDDEN'));

    const { renderer, queryClient } = await renderWithRoomRoute('/home/%23stale-alt%3Aexample.org');

    const buttonLabels = renderer.root.findAllByType('button').map((button) => textOf(button));
    expect(buttonLabels).toContain('Join');
    expect(buttonLabels).toContain('Decline');
    expect(buttonLabels).not.toContain('Retry room info');

    act(() => renderer.unmount());
    queryClient.clear();
  });

  describe('on a space room route whose space and room live on different servers', () => {
    const SPACE_ID = '!space:space.example.org';
    const ROOM_ID = '!room:room.example.org';
    const NESTED_ALIAS_ROUTE = '/%23space%3Aspace.example.org/%23room%3Aroom.example.org';
    const directory: Record<string, { room_id: string; servers: string[] }> = {
      '#space:space.example.org': { room_id: SPACE_ID, servers: ['space.example.org'] },
      '#room:room.example.org': { room_id: ROOM_ID, servers: ['room.example.org'] },
    };
    const answerDirectoryAndSummaries = () => {
      mockClientState.getRoomIdForAlias.mockImplementation(async (alias: string) => {
        const answer = directory[alias];
        if (!answer) throw new Error('M_NOT_FOUND');
        return answer;
      });
      mockClientState.getRoomSummary.mockImplementation(async (roomId: string) => ({
        room_id: roomId,
        name: roomId === SPACE_ID ? 'Harbor' : 'Field notes',
        join_rule: JoinRule.Public,
        num_joined_members: 4,
        ...(roomId === SPACE_ID ? { room_type: 'm.space' } : {}),
      }));
      mockClientState.joinRoom.mockImplementation(async (roomId: string) => ({ roomId }));
    };
    const clickJoin = async (renderer: ReactTestRenderer) => {
      const joinButton = renderer.root
        .findAllByType('button')
        .find((button) => textOf(button) === 'Join');
      expect(joinButton).toBeDefined();
      await act(async () => {
        (joinButton?.props.onClick as () => void)?.();
        await flush();
      });
    };

    it("asks for and joins an unjoined space through the space's servers, never the room's", async () => {
      signIn();
      answerDirectoryAndSummaries();

      const { renderer, queryClient } = await renderWithRoomRoute(NESTED_ALIAS_ROUTE);

      // The space's join page comes before the room's: only the space is asked about.
      expect(mockClientState.getRoomSummary.mock.calls).toEqual([
        [SPACE_ID, ['space.example.org']],
      ]);

      await clickJoin(renderer);

      expect(mockClientState.joinRoom.mock.calls).toEqual([
        [SPACE_ID, { viaServers: ['space.example.org'] }],
      ]);

      act(() => renderer.unmount());
      queryClient.clear();
    });

    it("asks for and joins an unjoined room of a joined space through the room's servers", async () => {
      signIn();
      answerDirectoryAndSummaries();
      mockClientState.rooms = [
        defaultRoom,
        {
          roomId: SPACE_ID,
          getMyMembership: () => KnownMembership.Join,
          getCanonicalAlias: () => null,
          getAltAliases: () => [],
          isSpaceRoom: () => true,
        } as unknown as Room,
      ];

      const { renderer, queryClient } = await renderWithRoomRoute(NESTED_ALIAS_ROUTE);

      expect(mockClientState.getRoomSummary.mock.calls).toEqual([[ROOM_ID, ['room.example.org']]]);

      await clickJoin(renderer);

      expect(mockClientState.joinRoom.mock.calls).toEqual([
        [ROOM_ID, { viaServers: ['room.example.org'] }],
      ]);

      act(() => renderer.unmount());
      queryClient.clear();
    });
  });
});
