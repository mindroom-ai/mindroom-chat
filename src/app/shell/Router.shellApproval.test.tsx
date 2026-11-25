// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAfterLoginRedirectPath } from '../routes/afterLoginRedirectPath';
import { getActiveSession } from '../matrix/session/sessions';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

vi.mock('../desktop-access/ShellApprovalView', () => ({
  ShellApprovalView: () => <p>shell approval view</p>,
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

describe('the /shell-approval/ floating window route', () => {
  it.each(['/shell-approval/', '/shell-approval'])(
    'renders immediately without waiting for Matrix login (%s)',
    async (url) => {
      expect(getActiveSession()).toBeUndefined();
      window.history.replaceState(null, '', url);
      const router = createRouter({});
      render(<RouterProvider router={router} />);
      expect(await screen.findByText('shell approval view')).toBeTruthy();
      await act(async () => undefined);
      expect(router.state.location.pathname).toMatch(/^\/shell-approval\/?$/);
      expect(screen.queryByText('signed-in app')).toBeNull();
      expect(screen.queryByText('sign-in pages')).toBeNull();
      expect(clientRoot).not.toHaveBeenCalled();
      expect(getAfterLoginRedirectPath()).toBeUndefined();
      router.dispose();
    }
  );
});
