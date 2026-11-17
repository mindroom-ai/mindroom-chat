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
import { ComputersSettingsPage } from './AgentSettingsPages';

const discovery = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('../../computer/useAgentServers', () => ({
  useAgentServerUrls: () => discovery.urls,
}));
vi.mock('folds', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({
    description,
    after,
    children,
  }: {
    description?: React.ReactNode;
    after?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      <p>{description}</p>
      {children}
      {after}
    </div>
  ),
}));
vi.mock('../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('../../ui/settings/SettingsSection', () => ({
  SettingsSection: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../ui/settings/AdvancedFold', () => ({ AdvancedFold: () => null }));
vi.mock('../../ui/settings/styles.css', () => ({ SequenceCardStyle: '' }));
vi.mock('../../computer/ComputerSettings', () => ({ ComputerSettings: () => null }));
vi.mock('../../connections/ConnectionsSettings', () => ({ ConnectionsSettings: () => null }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;

const render = (deploymentUrl?: string) =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          <ComputersSettingsPage requestClose={() => undefined} />
        </ClientConfigProvider>
      </Provider>
    );
  });
const texts = () => renderer.root.findAllByType('span').map((node) => node.children.join(''));
const findUseButton = () =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findByType('span').children.join('') === 'Use mindroom.lab.example');

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  discovery.urls = [];
});

afterEach(() => {
  act(() => renderer.unmount());
});

describe('Computers settings page', () => {
  it('offers to save the server found from the agents only while nothing names one', () => {
    discovery.urls = ['https://mindroom.lab.example'];
    render();
    expect(texts()).toContain('Found from your agents, not saved; save it to enter keys here.');
    act(() => {
      findUseButton()!.props.onClick();
    });
    expect(loadComputerServicePreference()).toBe('https://mindroom.lab.example');
    expect(store.get(computerServicePreferenceAtom)).toBe('https://mindroom.lab.example');
    expect(renderer.root.findByType('p').children).toEqual(['https://mindroom.lab.example']);
    expect(findUseButton()).toBeUndefined();
    expect(texts()).not.toContain('Found from your agents, not saved; save it to enter keys here.');
    act(() => renderer.unmount());
    localStorage.clear();
    store = createStore();
    render('https://computer.example.org');
    expect(findUseButton()).toBeUndefined();
  });
});
