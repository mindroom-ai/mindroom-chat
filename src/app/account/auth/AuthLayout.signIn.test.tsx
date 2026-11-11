// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import type { LoginResponse } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
  setAfterLoginRedirectPath,
} from '../../routes/afterLoginRedirectPath';
import { getActiveSession, removeSession } from '../../matrix/session/sessions';
import { followRouterSignalsInNode } from '../../../test/utils/nodeSignalRequests';
import { AuthLayout } from './AuthLayout';
import { useLoginComplete } from './login/loginUtil';

vi.mock('./styles.css', () =>
  Object.fromEntries(
    [
      'AuthScroll',
      'AuthLayout',
      'AuthCard',
      'AuthLogo',
      'AuthLogoHeading',
      'AuthHeader',
      'AuthCardContent',
      'AuthFooter',
    ].map((name) => [name, name])
  )
);
vi.mock('../../ui/styles/Glass.css', () => ({ glassOverBackdrop: 'glass-over-backdrop' }));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  Surface: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('./BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('../../ui/particle-background/PersistentParticleBackground', () => ({
  ParticleBackgroundSurface: () => null,
  usePersistentParticleBackground: () => false,
}));
vi.mock('../../config/useClientConfig', () => ({
  useClientConfig: () => ({ homeserverList: ['example.org'] }),
  useOptionalClientConfig: () => ({ homeserverList: ['example.org'] }),
}));
vi.mock('../../matrix/cs-api', async () => ({
  ...(await vi.importActual<typeof import('../../matrix/cs-api')>('../../matrix/cs-api')),
  autoDiscovery: () =>
    Promise.resolve([undefined, { 'm.homeserver': { base_url: 'https://example.org' } }]),
}));
vi.mock('./UnlistedServerCheck', () => ({
  UnlistedServerCheck: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./AuthFooter', () => ({ AuthFooter: () => null }));

followRouterSignalsInNode();
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
);

const loginResponse = {
  access_token: 'access',
  device_id: 'DEVICE',
  user_id: '@alice:example.org',
} as LoginResponse;

/** A login page whose sign-in completes on a click, as a password form's does. */
function SignIn() {
  const [response, setResponse] = useState<LoginResponse>();
  useLoginComplete(response && { baseUrl: 'https://example.org', response });
  return (
    <button type="button" onClick={() => setResponse(loginResponse)}>
      sign in
    </button>
  );
}

/** Signs in on the login page of the app's kind of router; returns where it ends up. */
const signIn = async (): Promise<string> => {
  window.history.replaceState(null, '', '/login/example.org/');
  const router = createBrowserRouter([
    { element: <AuthLayout />, children: [{ path: '/login/:server?/', element: <SignIn /> }] },
    { path: '/home/', element: <p>home page</p> },
    { path: '/p/:plugin/:page', element: <p>plugin page</p> },
  ]);
  render(<RouterProvider router={router} />);
  await act(async () => undefined);
  fireEvent.click(screen.getByText('sign in'));
  await act(async () => undefined);
  const { pathname } = router.state.location;
  router.dispose();
  return pathname;
};

afterEach(() => {
  cleanup();
  const session = getActiveSession();
  if (session) removeSession(session.sessionId);
  deleteAfterLoginRedirectPath();
  window.history.replaceState(null, '', '/');
});

describe('signing in on the sign-in pages', () => {
  it('opens the page the person asked for before signing in', async () => {
    setAfterLoginRedirectPath('/p/example/page');
    expect(await signIn()).toBe('/p/example/page');
    expect(screen.getByText('plugin page')).toBeTruthy();
    expect(getAfterLoginRedirectPath()).toBeUndefined();
  });

  it('opens Home when no page was asked for', async () => {
    expect(await signIn()).toBe('/home/');
    expect(screen.getByText('home page')).toBeTruthy();
  });
});
