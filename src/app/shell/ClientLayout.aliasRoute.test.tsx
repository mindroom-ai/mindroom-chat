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

  it("leaves the address of a redirect made before the alias route's replacement", async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
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
    const router = createBrowserRouter([
      {
        element: (
          <ClientLayout nav={null}>
            <Outlet />
          </ClientLayout>
        ),
        children: [{ path: '/home/:roomIdOrAlias/:eventId?', element: <RoomPage /> }],
      },
    ]);
    // The page shows the router's latest location a moment after it has it, as a phone's slide
    // does (navigation/phonePageSlide.ts): the locations of the moment between are never shown.
    const lagging = Object.create(router, {
      subscribe: {
        value: (listener: Parameters<typeof router.subscribe>[0]) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return router.subscribe((state, opts) => {
            clearTimeout(timer);
            timer = setTimeout(() => listener(state, opts), 5);
          });
        },
      },
    }) as typeof router;
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
    await act(async () => {
      create(<RouterProvider router={lagging} />);
      await settle();
    });

    // A link names the room by its alias.
    await act(async () => {
      await router.navigate('/home/%23room%3Aexample.org/%24root');
      await settle();
    });
    await act(async () => {
      await settle();
    });

    expect(router.state.location.pathname).toBe('/home/!room%3Aexample.org');
    expect(router.state.location.search).toBe('?threadId=%24root');
    router.dispose();
  });
});
