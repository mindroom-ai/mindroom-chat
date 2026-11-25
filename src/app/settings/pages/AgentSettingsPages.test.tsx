// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import {
  computerServicePreferenceAtom,
  loadComputerServicePreference,
} from '../../computer/computerServiceSettings';
import { MindroomSettingsPage } from './AgentSettingsPages';

const state = vi.hoisted(() => ({ urls: [] as string[], bundled: false }));
vi.mock('../../computer/useAgentServers', () => ({
  useAgentServerUrls: () => state.urls,
}));
vi.mock('../../lib/nativeShell', () => ({
  isBundledApp: () => state.bundled,
}));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({
    focusId,
    description,
    after,
    children,
  }: {
    focusId?: string;
    description?: React.ReactNode;
    after?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div data-focus-id={focusId}>
      <p>{description}</p>
      {children}
      {after}
    </div>
  ),
}));
vi.mock('../../ui/settings/SettingSwitchTile', () => ({
  SettingSwitchTile: ({ focusId }: { focusId?: string }) => <div data-focus-id={focusId} />,
}));
vi.mock('../../composer/ComposerSendButton', () => ({
  MID_TURN_CHOICES: [
    { mode: 'steer', label: 'composer.midTurn.steer' },
    { mode: 'queue', label: 'composer.midTurn.queue' },
    { mode: 'auto', label: 'composer.midTurn.auto' },
  ],
}));
vi.mock('../../ui/settings/ChoiceButton', () => ({
  ChoiceButton: ({ value }: { value: string }) => <div data-choice-value={value} />,
}));
vi.mock('../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({
    title,
    children,
  }: {
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) => <main data-page-title={title}>{children}</main>,
}));
vi.mock('../../ui/settings/SettingsSection', () => ({
  SettingsSection: ({
    title,
    children,
  }: {
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <section>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  ),
}));
vi.mock('../../ui/settings/AdvancedFold', () => ({ AdvancedFold: () => null }));
vi.mock('../../ui/settings/styles.css', () => ({ SequenceCardStyle: '' }));
vi.mock('../../computer/ComputerSettings', () => ({ ComputerSettings: () => null }));
vi.mock('../../connections/ConnectionsSettings', () => ({
  ConnectedAccountsTile: () => <div data-focus-id="connectedAccounts" />,
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

const FOUND_HINT = 'Found from your agents, not saved; save it to enter keys here.';
const FOUND_CHOOSE_HINT =
  'Found from your agents, not saved. Choose the server you trust; this device uses it for all rooms.';

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;

const render = (deploymentUrl?: string) =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          <MindroomSettingsPage requestClose={() => undefined} />
        </ClientConfigProvider>
      </Provider>
    );
  });
const texts = () => renderer.root.findAllByType('span').map((node) => node.children.join(''));
const serverInUseTile = () => renderer.root.findByProps({ 'data-focus-id': 'computerServerInUse' });
const serverDescriptions = () =>
  serverInUseTile()
    .findAllByType('p')
    .map((node) => node.children.join(''));
const findUseButton = (host = 'mindroom.lab.example') =>
  serverInUseTile()
    .findAllByType('button')
    .find((node) => node.findByType('span').children.join('') === `Use ${host}`);

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  state.urls = [];
  state.bundled = false;
});

afterEach(() => {
  act(() => renderer.unmount());
  vi.restoreAllMocks();
});

describe('Agents & servers settings page', () => {
  it('renders Replying, Messages, and Connections & computers sections, hiding Connected accounts in bundled apps', () => {
    render();
    expect(renderer.root.findByType('main').props['data-page-title']).toBe('Agents & servers');
    expect(renderer.root.findAllByType('h3').map((node) => node.children.join(''))).toEqual([
      'Replying',
      'Messages',
      'Connections & computers',
    ]);
    const focusIds = renderer.root
      .findAll((node) => typeof node.props['data-focus-id'] === 'string')
      .map((node) => node.props['data-focus-id']);
    expect(focusIds).toEqual([
      'midTurnSend',
      'showToolCalls',
      'showUsageDetails',
      'connectedAccounts',
      'computerServerInUse',
    ]);

    act(() => renderer.unmount());
    state.bundled = true;
    render();
    expect(renderer.root.findAllByProps({ 'data-focus-id': 'connectedAccounts' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-focus-id': 'computerServerInUse' })).toHaveLength(
      1
    );
  });

  it('offers to save the server found from the agents only while nothing names one', () => {
    state.urls = ['https://mindroom.lab.example'];
    render();
    expect(texts()).toContain(FOUND_HINT);
    act(() => {
      findUseButton()!.props.onClick();
    });
    expect(loadComputerServicePreference()).toBe('https://mindroom.lab.example');
    expect(store.get(computerServicePreferenceAtom)).toBe('https://mindroom.lab.example');
    expect(serverInUseTile().findByType('p').children).toEqual(['https://mindroom.lab.example']);
    expect(findUseButton()).toBeUndefined();
    expect(texts()).not.toContain(FOUND_HINT);
    act(() => renderer.unmount());
    localStorage.clear();
    store = createStore();
    render('https://computer.example.org');
    expect(findUseButton()).toBeUndefined();
  });

  it('offers a Use button for each of several found servers and saves the chosen origin', () => {
    state.urls = ['https://lab.example.org', 'https://other.example.org:8765'];
    render();
    expect(serverDescriptions()).toEqual([
      FOUND_CHOOSE_HINT,
      'https://lab.example.org',
      'https://other.example.org:8765',
    ]);
    expect(serverInUseTile().findAllByType('button')).toHaveLength(2);
    expect(findUseButton('lab.example.org')).toBeDefined();
    const otherButton = findUseButton('other.example.org:8765');
    expect(otherButton).toBeDefined();

    act(() => {
      otherButton!.props.onClick();
    });

    expect(loadComputerServicePreference()).toBe('https://other.example.org:8765');
    expect(store.get(computerServicePreferenceAtom)).toBe('https://other.example.org:8765');
    expect(serverDescriptions()).toEqual(['https://other.example.org:8765']);
    expect(serverInUseTile().findAllByType('button')).toHaveLength(0);
    expect(texts()).not.toContain(FOUND_HINT);
    expect(serverDescriptions()).not.toContain(FOUND_CHOOSE_HINT);
  });

  it('labels Use buttons with full origins when found servers share a host', () => {
    state.urls = ['http://localhost:8765', 'https://localhost:8765'];
    render();
    expect(findUseButton('http://localhost:8765')).toBeDefined();
    const httpsButton = findUseButton('https://localhost:8765');
    expect(httpsButton).toBeDefined();

    act(() => {
      httpsButton!.props.onClick();
    });

    expect(store.get(computerServicePreferenceAtom)).toBe('https://localhost:8765');
  });

  it('says so when this device refuses to store the found server and keeps all choices for retry', () => {
    state.urls = ['https://lab.example.org', 'https://other.example.org:8765'];
    render();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    act(() => {
      findUseButton('lab.example.org')!.props.onClick();
    });
    const alert = renderer.root.findAllByType('span').find((node) => node.props.role === 'alert');
    expect(alert?.children).toEqual(['Could not save the computer service on this device.']);
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    expect(findUseButton('lab.example.org')).toBeDefined();
    expect(findUseButton('other.example.org:8765')).toBeDefined();
  });
});
