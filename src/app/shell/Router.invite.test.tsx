// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
} from '../routes/afterLoginRedirectPath';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

// The route table is under test, not the pages (whose styles need the build's CSS plugin).
vi.mock('../account/auth/AuthLayout', () => ({ AuthLayout: () => <p>sign-in pages</p> }));
vi.mock('../account/auth/login/Login', () => ({ Login: () => null }));
vi.mock('../account/auth/register/Register', () => ({ Register: () => null }));
vi.mock('../account/auth/reset-password/ResetPassword', () => ({ ResetPassword: () => null }));
vi.mock('./ClientRoot', () => ({ ClientRoot: () => <p>signed-in app</p> }));

followRouterSignalsInNode();

afterEach(() => {
  cleanup();
  deleteAfterLoginRedirectPath();
  window.history.replaceState(null, '', '/');
});

describe('an invite link opened signed out', () => {
  it.each(['/invite/', '/invite', '/%69nvite/'])(
    'returns to %s after sign-in and keeps the code out of localStorage',
    async (path) => {
      window.history.replaceState(null, '', `${path}#r=%40router%3Aexample.org&c=secret-code`);
      const router = createRouter({});
      render(<RouterProvider router={router} />);
      await act(async () => undefined);
      expect(router.state.location.pathname).toMatch(/^\/login/);
      router.dispose();
      expect(getAfterLoginRedirectPath()).toBe(path);
      expect(JSON.stringify({ ...localStorage })).not.toContain('secret-code');
    }
  );
});
