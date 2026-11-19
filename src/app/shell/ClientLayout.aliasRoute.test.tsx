// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import {
  createBrowserRouter,
  MemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
  type Location,
} from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { putSession } from '../matrix/session/sessions';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';

// The notice places are tested in ui/noticeSlots.test.tsx.
vi.mock('../ui/noticeSlots', () => ({ NoticeSlot: () => null }));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
const getRoomIdForAlias = vi.fn();
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRooms: () => [
      {
        roomId: '!room:example.org',
        getCanonicalAlias: () => '#room:example.org',
        getAltAliases: () => [],
      },
    ],
    getRoomIdForAlias,
  }),
}));
vi.mock('../matrix/session/useSessionStore', async () => {
  const sessions = await import('../matrix/session/sessions');
  return { useActiveSession: () => sessions.getActiveSession() };
});

followRouterSignalsInNode();
afterEach(() => localStorage.clear());

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
      navigate?.('/home/%23room%3Aexample.org?threadId=%24root');
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

  afterEach(() => getRoomIdForAlias.mockReset());

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
        navigate('/home/%23room%3Aexample.org?threadId=%24root', { replace: true });
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
});
