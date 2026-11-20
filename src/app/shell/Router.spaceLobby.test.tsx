// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { getSpaceLobbyPath } from '../routes/pathUtils';
import { createRouter } from './Router';

// Where a space's own address lands: its lobby, at the address the app's links to it use. The
// route table is under test, not the pages: the account is signed in, and each page shows its name.
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
  SpaceRouteProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SpaceSectionPage: () => <Outlet />,
  // As in clientPages.tsx: phones stay at the section's address, its list out in the drawer.
  SectionIndex: ({ page, phonePage = page }: { page: ReactNode; phonePage?: ReactNode }) => (
    <>{useScreenSizeContext() === ScreenSize.Mobile ? phonePage : page}</>
  ),
  Lobby: () => <p>Lobby page</p>,
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
  window.history.replaceState(null, '', getSpaceLobbyPath('!space:example.org'));
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

describe("a space's own address", () => {
  it.each(['!space:example.org', '#space:example.org', '!sales/eu:example.org'])(
    'opens the lobby of %s on a desktop, at its link address',
    async (space) => {
      const url = `/${encodeURIComponent(space)}/`;
      expect(await open(url, ScreenSize.Desktop, 'Lobby page')).toBe(getSpaceLobbyPath(space));
    }
  );

  it('stays at the address on a phone, the lobby under its list', async () => {
    const url = `/${encodeURIComponent('!sales/eu:example.org')}/`;
    expect(await open(url, ScreenSize.Mobile, 'Lobby page')).toBe(url);
  });
});
