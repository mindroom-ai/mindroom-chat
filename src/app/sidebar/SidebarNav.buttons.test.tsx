import React from 'react';
import { create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  type AccountSettings,
} from '../preferences/accountSettings';
import { SidebarNav } from './SidebarNav';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';

const state = vi.hoisted(() => ({ settings: {} as Partial<AccountSettings> }));

// A rail button stand-in that names itself; a declaration, so the hoisted mocks can use it.
function tab(name: string) {
  return () => React.createElement('div', { 'data-tab': name });
}

vi.mock('folds', () => ({
  Scroll: React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) =>
    React.createElement('div', { ref }, children)
  ),
}));

vi.mock('../ui/sidebar/SidebarItem', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) =>
    React.createElement('nav', null, children),
  SidebarStackSeparator: () => React.createElement('hr'),
  SidebarStack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('../ui/sidebar/SidebarContent', () => ({
  SidebarContent: ({
    scrollable,
    sticky,
  }: {
    scrollable: React.ReactNode;
    sticky: React.ReactNode;
  }) => React.createElement('div', null, scrollable, sticky),
}));

vi.mock('../ui/sidebar/SidebarItem.css', () => ({}));
vi.mock('./rail/CanvasesTab', () => ({
  CanvasesTab: tab('canvases'),
}));
vi.mock('./rail/DirectTab', () => ({
  DirectTab: tab('direct'),
}));
vi.mock('./rail/ExploreTab', () => ({
  ExploreTab: tab('explore'),
}));
vi.mock('./rail/HomeTab', () => ({
  HomeTab: tab('home'),
}));
vi.mock('./rail/ActivityTab', () => ({
  ActivityTab: tab('activity'),
}));
vi.mock('../command-palette/CommandPaletteSidebarTab', () => ({
  SearchTab: tab('search'),
}));
vi.mock('./rail/SettingsTab', () => ({
  SettingsTab: tab('settings'),
}));
vi.mock('./rail/SpaceTabs', () => ({
  SpaceTabs: tab('spaces'),
}));
vi.mock('./rail/ThreadsTab', () => ({
  ThreadsTab: tab('threads'),
}));
vi.mock('../account/switcher/UnverifiedTab', () => ({
  UnverifiedTab: tab('unverified'),
}));
vi.mock('./rail/CreateTab', () => ({ CreateTab: tab('createSpace') }));
vi.mock('./rail/LocalMindroomTab', () => ({ LocalMindroomTab: tab('localMindroom') }));
vi.mock('../calls/CallTab', () => ({ CallTab: () => null }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://mindroom.chat',
    getAccessToken: () => 'token',
  }),
}));
vi.mock('../matrix/hooks/useAccountSettings', () => ({
  useAccountSettings: () => ({ ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS, ...state.settings }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const CANVASES: ClientConfig = { mindroom: { canvas: { enabled: true } } };

const renderedTabs = (config: ClientConfig = CANVASES, screenSize = ScreenSize.Desktop) => {
  const renderer = create(
    <ScreenSizeProvider value={screenSize}>
      <ClientConfigProvider value={config}>
        <SidebarNav />
      </ClientConfigProvider>
    </ScreenSizeProvider>
  );
  const tabs = renderer.root
    .findAll((node) => typeof node.props['data-tab'] === 'string')
    .map((node) => node.props['data-tab'] as string);
  const separators = renderer.root.findAllByType('hr').length;
  renderer.unmount();
  return { tabs, separators };
};

const SWITCHES: Array<[string, keyof AccountSettings]> = [
  ['threads', 'showThreadsInSidebar'],
  ['canvases', 'showCanvasesInSidebar'],
  ['explore', 'showExploreInSidebar'],
  ['createSpace', 'showCreateSpaceInSidebar'],
  ['search', 'showSearchInSidebar'],
  ['localMindroom', 'showLocalMindroomInSidebar'],
];

/** Every switch turned on, as an account that chose to show them all has stored. */
const ALL_ON: Partial<AccountSettings> = Object.fromEntries(
  SWITCHES.map(([, setting]) => [setting, true])
);

describe('SidebarNav buttons a person can hide', () => {
  afterEach(() => {
    state.settings = {};
  });

  it('shows none of the optional buttons for an account that never set them', () => {
    expect(renderedTabs().tabs).toEqual([
      'home',
      'direct',
      'spaces',
      'unverified',
      'activity',
      'settings',
    ]);
    // Only the rule between the scrolling and pinned parts.
    expect(renderedTabs().separators).toBe(1);
  });

  it('shows every optional button once each switch is on', () => {
    state.settings = ALL_ON;
    expect(renderedTabs().tabs).toEqual([
      'home',
      'direct',
      'threads',
      'canvases',
      'spaces',
      'explore',
      'createSpace',
      'search',
      'unverified',
      'localMindroom',
      'activity',
      'settings',
    ]);
  });

  it.each(SWITCHES)('hides %s when its switch is off and keeps the rest', (button, setting) => {
    state.settings = { ...ALL_ON, [setting]: false };
    const { tabs } = renderedTabs();
    expect(tabs).not.toContain(button);
    expect(tabs).toHaveLength(11);
  });

  it.each(SWITCHES)('shows only %s when only its switch is on', (button, setting) => {
    state.settings = { [setting]: true };
    const { tabs } = renderedTabs();
    expect(tabs).toContain(button);
    expect(tabs).toHaveLength(7);
  });

  it('keeps the rule above Explore and Create Space while one of them shows', () => {
    // Between the joined spaces and that group, and between the scrolling and pinned parts.
    state.settings = ALL_ON;
    expect(renderedTabs().separators).toBe(2);
    state.settings = { ...ALL_ON, showExploreInSidebar: false };
    expect(renderedTabs().separators).toBe(2);
    state.settings = { ...ALL_ON, showExploreInSidebar: false, showCreateSpaceInSidebar: false };
    expect(renderedTabs().separators).toBe(1);
  });

  it('lets the deployment hide a button whatever the switch says', () => {
    state.settings = ALL_ON;
    const { tabs } = renderedTabs({ sidebar: { showThreads: false, showExploreCommunity: false } });
    expect(tabs).not.toContain('threads');
    expect(tabs).not.toContain('explore');
    expect(tabs).not.toContain('createSpace');
    expect(renderedTabs({}).tabs).not.toContain('canvases');
    expect(renderedTabs({ sidebar: { showMindRoom: false } }).tabs).not.toContain('localMindroom');
  });

  it('leaves the command palette to the top bar on phones and keeps the account at the foot', () => {
    state.settings = ALL_ON;
    const { tabs } = renderedTabs(CANVASES, ScreenSize.Mobile);
    expect(tabs).not.toContain('search');
    expect(tabs).toContain('activity');
    expect(tabs.at(-1)).toBe('settings');
  });
});
