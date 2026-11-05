// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

// Where the Inbox's addresses land. The route table is under test, not the pages: the account is
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
  // As in clientPages.tsx: on phones the section's list takes the place of its own page.
  SectionIndex: ({ page }: { page: ReactNode }) =>
    useScreenSizeContext() === ScreenSize.Mobile ? null : <>{page}</>,
  InboxNav: () => <p>Inbox list</p>,
  Invites: () => <p>Invites page</p>,
  Notifications: () => <p>Notifications page</p>,
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
  window.history.replaceState(null, '', '/inbox/notifications/');
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

describe('the Inbox routes', () => {
  it.each([ScreenSize.Desktop, ScreenSize.Tablet])(
    'open the bare Inbox address on Invites (%s)',
    async (screenSize) => {
      expect(await open('/inbox/', screenSize, 'Invites page')).toBe('/inbox/invites/');
      cleanup();
      expect(await open('/inbox', screenSize, 'Invites page')).toBe('/inbox/invites/');
    }
  );

  it('keep phones on the Inbox list there, where the Back of its pages leads', async () => {
    expect(await open('/inbox/', ScreenSize.Mobile, 'Inbox list')).toBe('/inbox/');
    expect(screen.queryByText('Invites page')).toBeNull();
  });

  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'keep the addresses of the Inbox pages (%s)',
    async (screenSize) => {
      expect(await open('/inbox/notifications/', screenSize, 'Notifications page')).toBe(
        '/inbox/notifications/'
      );
      cleanup();
      expect(await open('/inbox/invites/', screenSize, 'Invites page')).toBe('/inbox/invites/');
    }
  );
});
