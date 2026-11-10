// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

// Where the Activity section's addresses, and the Inbox's old ones, land. The route table is under test, not the pages: the account is
// signed in, and each page shows its name.
vi.mock('../local-mindroom/ConnectPage', () => ({ ConnectPage: () => null }));
vi.mock('../account/auth/AuthLayout', () => ({ AuthLayout: () => null }));
vi.mock('../account/auth/login/Login', () => ({ Login: () => null }));
vi.mock('../account/auth/register/Register', () => ({ Register: () => null }));
vi.mock('../account/auth/reset-password/ResetPassword', () => ({ ResetPassword: () => null }));
vi.mock('../navigation/routeSessionGuards', () => ({
  resolveProtectedRouteRedirect: () => null,
  resolveRootRouteRedirect: () => ({ redirectTo: '/home/' }),
}));
vi.mock('./ClientRoot', () => ({
  ClientRoot: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../room/Room', () => ({ Room: () => null }));
vi.mock('./clientPages', () => ({
  SignedInChrome: () => <Outlet />,
  SectionPage: ({ nav }: { nav: ReactNode }) => (
    <>
      {nav}
      <Outlet />
    </>
  ),
  // As in clientPages.tsx: phones stay at the section's address, its list out in the drawer.
  SectionIndex: ({ page, phonePage = page }: { page: ReactNode; phonePage?: ReactNode }) => (
    <>{useScreenSizeContext() === ScreenSize.Mobile ? phonePage : page}</>
  ),
  RoomRoute: ({ children }: { children: ReactNode }) => (
    <>
      <p>Room route</p>
      {children}
    </>
  ),
  ActivityNav: () => <p>Activity list</p>,
  ThreadsNav: () => <p>Threads list</p>,
  ThreadsEmpty: () => <p>Threads empty</p>,
  ActivityEmpty: () => <p>Activity empty</p>,
  Invites: () => <p>Invites page</p>,
}));

followRouterSignalsInNode();

const renderRouter = (router: ReturnType<typeof createRouter>, screenSize: ScreenSize) =>
  render(
    <ScreenSizeProvider value={screenSize}>
      <RouterProvider router={router} />
    </ScreenSizeProvider>
  );

// The first signed-in route imports the page module twice at once, to preload it and for its
// first page, and under vitest two concurrent imports of a mocked module never both resolve. One
// render here loads it, so the cases render the pages directly, as the app does once it is in.
beforeAll(async () => {
  window.history.replaceState(null, '', '/activity/');
  const router = createRouter({});
  renderRouter(router, ScreenSize.Desktop);
  await act(async () => undefined);
  cleanup();
  router.dispose();
});

/** Opens `url` at `screenSize` and waits for `shows`; returns the address the router ends on. */
const open = async (url: string, screenSize: ScreenSize, shows: string): Promise<string> => {
  window.history.replaceState(null, '', url);
  const router = createRouter({});
  renderRouter(router, screenSize);
  await screen.findByText(shows);
  // A redirect still on its way would land now.
  await act(async () => undefined);
  const { pathname } = router.state.location;
  router.dispose();
  return pathname;
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('the Activity routes', () => {
  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'show the Activity list beside its empty page (%s)',
    async (screenSize) => {
      expect(await open('/activity/', screenSize, 'Activity empty')).toBe('/activity/');
      expect(screen.getByText('Activity list')).toBeTruthy();
    }
  );

  it('show a room, and its thread, beside the list', async () => {
    const url = `/activity/${encodeURIComponent('!room:x')}/?threadId=${encodeURIComponent('$t')}`;
    expect(await open(url, ScreenSize.Desktop, 'Room route')).toBe(
      `/activity/${encodeURIComponent('!room:x')}/`
    );
    expect(screen.getByText('Activity list')).toBeTruthy();
  });

  it('keep the invite list under Activity', async () => {
    expect(await open('/activity/invites/', ScreenSize.Desktop, 'Invites page')).toBe(
      '/activity/invites/'
    );
  });

  it.each(['/inbox/', '/inbox/invites/', '/inbox/notifications/'])(
    'send the old Inbox address %s to Activity',
    async (url) => {
      expect(await open(url, ScreenSize.Desktop, 'Activity empty')).toBe('/activity/');
    }
  );
});

describe('the Threads routes', () => {
  it('show the Threads list beside its empty page, and a thread beside the list', async () => {
    expect(await open('/threads/', ScreenSize.Desktop, 'Threads empty')).toBe('/threads/');
    expect(screen.getByText('Threads list')).toBeTruthy();
    cleanup();
    const url = `/threads/${encodeURIComponent('!room:x')}/?threadId=${encodeURIComponent('$t')}`;
    expect(await open(url, ScreenSize.Desktop, 'Room route')).toBe(
      `/threads/${encodeURIComponent('!room:x')}/`
    );
    expect(screen.getByText('Threads list')).toBeTruthy();
  });
});
