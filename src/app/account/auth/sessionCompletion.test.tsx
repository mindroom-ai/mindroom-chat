// @vitest-environment jsdom

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LoginResponse, RegisterResponse } from 'matrix-js-sdk';
import { useLoginComplete } from './login/loginUtil';
import { useRegisterComplete } from './register/registerUtil';
import { getAfterLoginRedirectPath, setAfterLoginRedirectPath } from '../../routes/afterLoginRedirectPath';
import { getActiveSession } from '../../matrix/session/sessions';

const originalLocalStorage = globalThis.localStorage;

const installBlockedStorage = () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    },
  });
};

const LoginCompletion = ({ response }: { response: LoginResponse }) => {
  const failed = useLoginComplete({ baseUrl: 'https://example.org', response });
  return <span>{failed ? 'storage-error' : 'pending'}</span>;
};

const loginResponse = {
  access_token: 'access',
  device_id: 'DEVICE',
  user_id: '@alice:example.org',
} as LoginResponse;

const renderLoginRoutes = () =>
  create(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginCompletion response={loginResponse} />} />
        <Route path="/connect" element={<span>connect-page</span>} />
        <Route path="/home" element={<span>home-page</span>} />
      </Routes>
    </MemoryRouter>
  );

const RegisterCompletion = ({ response }: { response: RegisterResponse }) => {
  const failed = useRegisterComplete({ baseUrl: 'https://example.org', response });
  return <span>{failed ? 'storage-error' : 'pending'}</span>;
};

describe('authentication session completion', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    window.history.replaceState(null, '', '/');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('surfaces a blocked credential-store write after login', async () => {
    installBlockedStorage();

    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <LoginCompletion
            response={
              {
                access_token: 'access',
                device_id: 'DEVICE',
                user_id: '@alice:example.org',
              } as LoginResponse
            }
          />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(renderer?.root.findByType('span').children).toEqual(['storage-error']);
  });

  it('surfaces a blocked credential-store write after registration', async () => {
    installBlockedStorage();

    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <RegisterCompletion
            response={
              {
                access_token: 'access',
                device_id: 'DEVICE',
                user_id: '@alice:example.org',
              } as RegisterResponse
            }
          />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(renderer?.root.findByType('span').children).toEqual(['storage-error']);
  });

  // Adding an account stays on the sign-in pages, so the completion opens the page itself; a
  // plain sign-in leaves that to AuthLayout (AuthLayout.signIn.test.tsx).
  it('returns to the saved after-login path after adding an account', async () => {
    localStorage.clear();
    window.history.replaceState(null, '', '/login?addAccount=1');
    setAfterLoginRedirectPath('/connect?code=ABCD-EFGH');

    await act(async () => {
      renderer = renderLoginRoutes();
      await Promise.resolve();
    });

    expect(renderer?.root.findByType('span').children).toEqual(['connect-page']);
    expect(getAfterLoginRedirectPath()).toBeUndefined();
    expect(getActiveSession()?.userId).toBe('@alice:example.org');
  });

  it('opens home without a saved after-login path after adding an account', async () => {
    localStorage.clear();
    window.history.replaceState(null, '', '/login?addAccount=1');

    await act(async () => {
      renderer = renderLoginRoutes();
      await Promise.resolve();
    });

    expect(renderer?.root.findByType('span').children).toEqual(['home-page']);
  });
});
