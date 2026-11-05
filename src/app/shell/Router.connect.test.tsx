// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import {
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
} from '../routes/afterLoginRedirectPath';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';
import { createRouter } from './Router';

// The route table is under test, not the pages (whose styles need the build's CSS plugin).
vi.mock('../local-mindroom/ConnectPage', () => ({
  ConnectPage: () => <p>pairing page</p>,
}));
vi.mock('../account/auth/AuthLayout', () => ({ AuthLayout: () => <p>sign-in pages</p> }));
vi.mock('../account/auth/login/Login', () => ({ Login: () => null }));
vi.mock('../account/auth/register/Register', () => ({ Register: () => null }));
vi.mock('../account/auth/reset-password/ResetPassword', () => ({ ResetPassword: () => null }));
vi.mock('./ClientRoot', () => ({ ClientRoot: () => <p>signed-in app</p> }));

const PAIRING_LINKS = ['/connect/?code=ABCD-EFGH', '/connect?code=ABCD-EFGH', '/connect/'];

followRouterSignalsInNode();

/** Opens `url` in the app's router under `config`; returns where it ends up. */
const open = async (url: string, config: ClientConfig): Promise<string> => {
  window.history.replaceState(null, '', url);
  const router = createRouter(config);
  render(<RouterProvider router={router} />);
  await act(async () => undefined);
  const { pathname } = router.state.location;
  router.dispose();
  return pathname;
};

afterEach(() => {
  cleanup();
  deleteAfterLoginRedirectPath();
  window.history.replaceState(null, '', '/');
});

describe('the /connect pairing page', () => {
  it.each(PAIRING_LINKS)('opens by default and with showMindRoom true (%s)', async (url) => {
    expect(await open(url, {})).toMatch(/^\/connect\/?$/);
    expect(screen.getByText('pairing page')).toBeTruthy();
    cleanup();
    expect(await open(url, { sidebar: { showMindRoom: true } })).toMatch(/^\/connect\/?$/);
    expect(screen.getByText('pairing page')).toBeTruthy();
  });

  it.each(PAIRING_LINKS)(
    'goes to / and on to sign-in, not a space named "connect", with showMindRoom false (%s)',
    async (url) => {
      const landed = await open(url, { sidebar: { showMindRoom: false } });
      expect(landed).not.toMatch(/^\/connect/);
      expect(screen.queryByText('pairing page')).toBeNull();
      expect(screen.queryByText('signed-in app')).toBeNull();
      expect(screen.getByText('sign-in pages')).toBeTruthy();
      // As a space route, the link would wait to open after sign-in.
      expect(getAfterLoginRedirectPath() ?? '').not.toMatch(/connect/);
    }
  );
});
