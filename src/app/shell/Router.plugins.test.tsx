// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

// Where plugin page addresses land. The route table is under test, not the pages: the account is
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
  SectionPage: () => <p>Home page</p>,
  SpaceRouteProvider: () => <p>Space page</p>,
  PluginPageRoute: () => <p>Plugin page</p>,
}));

followRouterSignalsInNode();

// As in Router.inbox.test.tsx: one render loads the mocked page module before the cases run.
beforeAll(async () => {
  window.history.replaceState(null, '', '/p/example/');
  const router = createRouter({});
  render(<RouterProvider router={router} />);
  await act(async () => undefined);
  cleanup();
  router.dispose();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('plugin page addresses', () => {
  // `search` and `lobby` are also the fixed segments of a space's own pages.
  it.each([
    '/p/example/',
    '/p/example',
    '/p/example/window',
    '/p/example/items/42/',
    '/p/gone/a/b/c/d',
    '/p/search',
    '/p/lobby/',
  ])('open the plugin page route at %s and stay there', async (url) => {
    window.history.replaceState(null, '', url);
    const router = createRouter({});
    render(<RouterProvider router={router} />);
    await screen.findByText('Plugin page');
    await act(async () => undefined);
    expect(router.state.location.pathname).toBe(url);
    expect(screen.queryByText('Space page')).toBeNull();
    router.dispose();
  });
});
