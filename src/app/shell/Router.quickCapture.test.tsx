// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAfterLoginRedirectPath } from '../routes/afterLoginRedirectPath';
import { getActiveSession } from '../matrix/session/sessions';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

// The route table is under test, not the pages (whose styles need the build's CSS plugin).
vi.mock('../quick-capture/QuickCapturePage', () => ({
  QuickCapturePage: () => <p>quick capture page</p>,
}));
vi.mock('../account/auth/AuthLayout', () => ({ AuthLayout: () => <p>sign-in pages</p> }));
vi.mock('../account/auth/login/Login', () => ({ Login: () => null }));
vi.mock('../account/auth/register/Register', () => ({ Register: () => null }));
vi.mock('../account/auth/reset-password/ResetPassword', () => ({ ResetPassword: () => null }));
const clientRoot = vi.hoisted(() => vi.fn(() => <p>signed-in app</p>));
vi.mock('./ClientRoot', () => ({ ClientRoot: clientRoot }));

followRouterSignalsInNode();

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('the /quick-capture/ widget page', () => {
  it.each(['/quick-capture/', '/quick-capture'])(
    'renders for a visitor with no session, without the signed-in app (%s)',
    async (url) => {
      expect(getActiveSession()).toBeUndefined();
      window.history.replaceState(null, '', url);
      const router = createRouter({});
      render(<RouterProvider router={router} />);
      expect(await screen.findByText('quick capture page')).toBeTruthy();
      await act(async () => undefined);
      expect(router.state.location.pathname).toMatch(/^\/quick-capture\/?$/);
      expect(screen.queryByText('signed-in app')).toBeNull();
      expect(screen.queryByText('sign-in pages')).toBeNull();
      expect(clientRoot).not.toHaveBeenCalled();
      expect(getAfterLoginRedirectPath()).toBeUndefined();
      router.dispose();
    }
  );
});
