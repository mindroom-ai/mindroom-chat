// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import { MindroomConnectionsSettings } from './MindroomConnectionsSettings';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  openConnectionsPortal: vi.fn(),
  getOpenIdToken: vi.fn(),
}));

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    children,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  ),
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getOpenIdToken: mocks.getOpenIdToken }),
}));
vi.mock('../connections/openConnections', () => ({
  openConnectionsPortal: mocks.openConnectionsPortal,
}));

const OPEN_LABEL = 'Open Connections';
const NO_BACKEND = 'Set your MindRoom server under Computers to use Connections.';
const BLOCKED =
  'Your browser blocked the Connections window. Allow pop-ups for this site and try again.';

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;
const openButton = () =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findByType('span').children.join('') === OPEN_LABEL)!;
const texts = () => renderer.root.findAllByType('span').map((node) => node.children.join(''));
const alerts = () =>
  renderer.root.findAllByType('span').filter((node) => node.props.role === 'alert');
const click = () => act(() => openButton().props.onClick());

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  mocks.isNativePlatform.mockReset().mockReturnValue(false);
  mocks.openConnectionsPortal.mockReset().mockReturnValue('opened');
  mocks.getOpenIdToken.mockReset();
});
afterEach(() => {
  act(() => renderer?.unmount());
});
const render = (deploymentUrl = 'https://backend.example') =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          <MindroomConnectionsSettings />
        </ClientConfigProvider>
      </Provider>
    );
  });

describe('connections settings', () => {
  it('renders nothing on native builds', () => {
    mocks.isNativePlatform.mockReturnValue(true);
    render();
    expect(renderer.toJSON()).toBeNull();
  });

  it('shows the card copy with an enabled button when a server is configured', () => {
    render();
    expect(texts()).toContain('Connections');
    expect(renderer.root.findByType('h3').children).toEqual(['Connected accounts']);
    expect(renderer.root.findByType('p').children).toEqual([
      'Connect the accounts your agents use, such as Google or GitHub, on your MindRoom server.',
    ]);
    expect(openButton().props.disabled).toBeFalsy();
    expect(texts()).not.toContain(NO_BACKEND);
  });

  it('explains how to set a server when none is configured', () => {
    render('');
    expect(openButton().props.disabled).toBe(true);
    expect(texts()).toContain(NO_BACKEND);
    expect(mocks.openConnectionsPortal).not.toHaveBeenCalled();
  });

  it('treats a server the user turned off under Computers as not configured', () => {
    act(() => store.set(computerServicePreferenceAtom, ''));
    render('https://backend.example');
    expect(openButton().props.disabled).toBe(true);
    expect(texts()).toContain(NO_BACKEND);
  });

  it('opens the portal with the computers backend', () => {
    render('https://backend.example');
    click();
    expect(mocks.openConnectionsPortal).toHaveBeenCalledTimes(1);
    const options = mocks.openConnectionsPortal.mock.calls[0][0];
    expect(options.backendUrl).toBe('https://backend.example');
    expect(alerts()).toHaveLength(0);
  });

  it('opens the portal with a server the user saved under Computers', () => {
    act(() => store.set(computerServicePreferenceAtom, 'https://custom.example'));
    render('https://backend.example');
    click();
    expect(mocks.openConnectionsPortal.mock.calls[0][0].backendUrl).toBe('https://custom.example');
  });

  it('hands the portal the signed-in client token request', async () => {
    const token = { access_token: 'openid-token' };
    mocks.getOpenIdToken.mockResolvedValue(token);
    render();
    click();
    const options = mocks.openConnectionsPortal.mock.calls[0][0];
    expect(mocks.getOpenIdToken).not.toHaveBeenCalled();
    await expect(options.getOpenIdToken()).resolves.toBe(token);
    expect(mocks.getOpenIdToken).toHaveBeenCalledTimes(1);
  });

  it('shows the blocked message when the window is blocked', () => {
    mocks.openConnectionsPortal.mockReturnValue('blocked');
    render();
    click();
    expect(alerts().map((node) => node.children.join(''))).toEqual([BLOCKED]);
  });

  it('clears the blocked message once a later attempt opens the window', () => {
    mocks.openConnectionsPortal.mockReturnValueOnce('blocked').mockReturnValueOnce('opened');
    render();
    click();
    expect(alerts()).toHaveLength(1);
    click();
    expect(alerts()).toHaveLength(0);
    expect(mocks.openConnectionsPortal).toHaveBeenCalledTimes(2);
  });
});
