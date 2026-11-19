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
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('an invite link opened signed out', () => {
  it('returns to /invite/ after sign-in and keeps the code out of localStorage', async () => {
    window.history.replaceState(null, '', '/invite/#r=%40router%3Aexample.org&c=secret-code');
    const router = createRouter({});
    render(<RouterProvider router={router} />);
    await act(async () => undefined);
    expect(router.state.location.pathname).toMatch(/^\/login/);
    router.dispose();
    expect(getAfterLoginRedirectPath()).toBe('/invite/');
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-code');
    // The code waits in this tab only.
    expect(JSON.stringify({ ...sessionStorage })).toContain('secret-code');
  });
});
