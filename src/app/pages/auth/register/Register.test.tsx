import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegisterFlowStatus, type AuthFlows } from '../../../components/AuthFlowsLoader';
import { useClientConfig, type ClientConfig } from '../../../hooks/useClientConfig';
import { LOGIN_PATH, REGISTER_PATH } from '../../paths';
import { Register } from './Register';

const flows = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../../../components/AuthFlowsLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/AuthFlowsLoader')>()),
  AuthFlowsLoader: ({ children }: { children: (authFlows: AuthFlows) => React.ReactNode }) =>
    children(flows.current as AuthFlows),
}));

vi.mock('../../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => ({ 'm.homeserver': { base_url: 'https://matrix.example.org' } }),
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(() => ({})),
}));

vi.mock('./PasswordRegisterForm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./PasswordRegisterForm')>()),
  PasswordRegisterForm: () => <div data-password-form />,
}));

vi.mock('../SSOLogin', () => ({
  SSOLogin: () => <div data-sso />,
}));

const openRegistration = (sso: boolean): AuthFlows => ({
  loginFlows: {
    flows: [
      { type: 'm.login.password' },
      ...(sso ? [{ type: 'm.login.sso', identity_providers: [] }] : []),
    ] as AuthFlows['loginFlows']['flows'],
  },
  registerFlows: {
    status: RegisterFlowStatus.FlowRequired,
    data: { flows: [{ stages: ['m.login.dummy'] }], params: {} },
  },
});

const renderRegister = (auth: ClientConfig['auth'], authFlows: AuthFlows): ReactTestRenderer => {
  flows.current = authFlows;
  vi.mocked(useClientConfig).mockReturnValue({ auth });
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MemoryRouter initialEntries={['/register/example.org/']}>
        <Routes>
          <Route element={<Outlet context={{ server: 'example.org' }} />}>
            <Route path={REGISTER_PATH} element={<Register />} />
            <Route path={LOGIN_PATH} element={<div data-login />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  });
  return renderer;
};

const count = (renderer: ReactTestRenderer, prop: string) =>
  renderer.root.findAll((node) => typeof node.type === 'string' && node.props[prop] !== undefined)
    .length;

describe('Register', () => {
  afterEach(() => {
    vi.mocked(useClientConfig).mockReturnValue({});
  });

  it('offers password sign-up when the server and the deployment allow it', () => {
    const renderer = renderRegister(undefined, openRegistration(true));
    expect(count(renderer, 'data-password-form')).toBe(1);
    expect(count(renderer, 'data-sso')).toBe(1);
  });

  it('sends the page to login when the deployment turned registration off', () => {
    const renderer = renderRegister({ allowRegistration: false }, openRegistration(true));
    expect(count(renderer, 'data-login')).toBe(1);
    expect(count(renderer, 'data-password-form')).toBe(0);
  });

  it('hides the password form when password sign-in is disabled', () => {
    const renderer = renderRegister({ disablePasswordLogin: true }, openRegistration(true));
    expect(count(renderer, 'data-password-form')).toBe(0);
    expect(count(renderer, 'data-sso')).toBe(1);
  });
});
