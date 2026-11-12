import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../../config/useClientConfig';
import { DEFAULT_MINDROOM_ACCOUNT_SETTINGS } from '../../preferences/accountSettings';
import { AgentInterfaceSettings } from './AgentInterfaceSettings';

const state = vi.hoisted(() => ({
  config: {} as ClientConfig,
  localMindroom: true,
  write: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../config/useClientConfig', () => ({ useClientConfig: () => state.config }));
vi.mock('../../local-mindroom/useShowLocalMindroom', () => ({
  useShowLocalMindroom: () => state.localMindroom,
}));
// An account that stored Threads and Create Space on and Search off, and never set the rest.
vi.mock('../../matrix/hooks/useAccountSettings', () => ({
  useAccountSettings: () => ({
    ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
    showThreadsInSidebar: true,
    showCreateSpaceInSidebar: true,
    showSearchInSidebar: false,
  }),
  useSetAccountSettings: () => state.write,
}));
vi.mock('../../command-palette/commandPaletteShortcut', () => ({
  getCommandPaletteShortcutLabel: () => 'Ctrl + K',
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  Switch: ({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) =>
    React.createElement('button', {
      role: 'switch',
      'aria-checked': value,
      onClick: () => onChange(!value),
    }),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('../../ui/SequenceCard', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));
vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description: string;
    after: React.ReactNode;
  }) => React.createElement('div', { 'data-title': title, 'data-description': description }, after),
}));

const render = (config: ClientConfig = {}) => {
  state.config = config;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<AgentInterfaceSettings />);
  });
  return renderer;
};

const titles = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.props['data-title'] === 'string')
    .map((node) => node.props['data-title'] as string);

const tile = (renderer: ReactTestRenderer, title: string) =>
  renderer.root.find((node) => node.props['data-title'] === title);

describe('Settings > General > Sidebar', () => {
  afterEach(() => {
    state.localMindroom = true;
    state.write.mockClear();
  });

  it('lists a switch for each rail button the deployment offers, in rail order', () => {
    const renderer = render({ mindroom: { canvas: { enabled: true } } });
    expect(renderer.root.findAllByType('span').map((node) => node.children[0])[0]).toBe('Sidebar');
    expect(titles(renderer)).toEqual([
      'Show Threads in the sidebar',
      'Show Canvases in the sidebar',
      'Show Explore Community in the sidebar',
      'Show Create Space in the sidebar',
      'Show Search in the sidebar',
      'Show Local MindRoom in the sidebar',
    ]);
  });

  it('leaves out the switches of buttons the deployment or the account cannot show', () => {
    state.localMindroom = false;
    const renderer = render({ sidebar: { showThreads: false, showExploreCommunity: false } });
    expect(titles(renderer)).toEqual(['Show Search in the sidebar']);
  });

  it('says where each hidden page stays reachable', () => {
    const renderer = render({ mindroom: { canvas: { enabled: true } } });
    const description = (title: string) => tile(renderer, title).props['data-description'];
    expect(description('Show Threads in the sidebar')).toContain('⋮ menu in Home');
    expect(description('Show Canvases in the sidebar')).toContain('⋮ menu in Home');
    expect(description('Show Explore Community in the sidebar')).toContain('⋮ menu in Home');
    expect(description('Show Create Space in the sidebar')).toContain('⋮ menu in Home');
    expect(description('Show Create Space in the sidebar')).toContain('command palette (Ctrl + K)');
    expect(description('Show Search in the sidebar')).toContain('Find anything field');
    expect(description('Show Search in the sidebar')).toContain('with Ctrl + K');
    expect(description('Show Local MindRoom in the sidebar')).toContain(
      'Settings under Local MindRoom'
    );
  });

  it('shows each stored value and writes the switch that was turned', async () => {
    const renderer = render();
    const toggle = (title: string) => tile(renderer, title).findByType('button');
    expect(toggle('Show Threads in the sidebar').props['aria-checked']).toBe(true);
    expect(toggle('Show Search in the sidebar').props['aria-checked']).toBe(false);
    expect(toggle('Show Explore Community in the sidebar').props['aria-checked']).toBe(false);

    await act(async () => {
      toggle('Show Create Space in the sidebar').props.onClick();
    });
    expect(state.write).toHaveBeenCalledWith({ showCreateSpaceInSidebar: false });
    await act(async () => {
      toggle('Show Search in the sidebar').props.onClick();
    });
    expect(state.write).toHaveBeenLastCalledWith({ showSearchInSidebar: true });
  });
});
