import React from 'react';
import { create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../hooks/useClientConfig';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  type MindroomAccountSettings,
} from '../../mindroom/settings/mindroomAccountSettings';
import { SidebarNav } from './SidebarNav';

const state = vi.hoisted(() => ({ settings: {} as Partial<MindroomAccountSettings> }));

// A rail button stand-in that names itself; a declaration, so the hoisted mocks can use it.
function tab(name: string) {
  return () => React.createElement('div', { 'data-tab': name });
}

vi.mock('folds', () => ({
  Scroll: React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) =>
    React.createElement('div', { ref }, children)
  ),
}));

vi.mock('../../components/sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) =>
    React.createElement('nav', null, children),
  SidebarContent: ({ scrollable, sticky }: { scrollable: React.ReactNode; sticky: React.ReactNode }) =>
    React.createElement('div', null, scrollable, sticky),
  SidebarStackSeparator: () => React.createElement('hr'),
  SidebarStack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('./sidebar', () => ({
  CanvasesTab: tab('canvases'),
  DirectTab: tab('direct'),
  ExploreTab: tab('explore'),
  HomeTab: tab('home'),
  InboxTab: tab('inbox'),
  SearchTab: tab('search'),
  SettingsTab: tab('settings'),
  SpaceTabs: tab('spaces'),
  ThreadsTab: tab('threads'),
  UnverifiedTab: tab('unverified'),
}));
vi.mock('./sidebar/CreateTab', () => ({ CreateTab: tab('createSpace') }));
vi.mock('../../mindroom/sidebar/MindroomTab', () => ({ MindroomTab: tab('localMindroom') }));
vi.mock('../../features/calls/CallTab', () => ({ CallTab: () => null }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://mindroom.chat',
    getAccessToken: () => 'token',
  }),
}));
vi.mock('../../mindroom/settings/useMindroomAccountSettings', () => ({
  useMindroomAccountSettings: () => ({ ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS, ...state.settings }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const CANVASES: ClientConfig = { mindroom: { canvas: { enabled: true } } };

const renderedTabs = (config: ClientConfig = CANVASES) => {
  const renderer = create(
    <ClientConfigProvider value={config}>
      <SidebarNav />
    </ClientConfigProvider>
  );
  const tabs = renderer.root
    .findAll((node) => typeof node.props['data-tab'] === 'string')
    .map((node) => node.props['data-tab'] as string);
  const separators = renderer.root.findAllByType('hr').length;
  renderer.unmount();
  return { tabs, separators };
};

const SWITCHES: Array<[string, keyof MindroomAccountSettings]> = [
  ['threads', 'showThreadsInSidebar'],
  ['canvases', 'showCanvasesInSidebar'],
  ['explore', 'showExploreInSidebar'],
  ['createSpace', 'showCreateSpaceInSidebar'],
  ['search', 'showSearchInSidebar'],
  ['localMindroom', 'showLocalMindroomInSidebar'],
];

describe('SidebarNav buttons a person can hide', () => {
  afterEach(() => {
    state.settings = {};
  });

  it('shows every optional button by default', () => {
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
      'inbox',
      'settings',
    ]);
  });

  it.each(SWITCHES)('hides %s when its switch is off and keeps the rest', (button, setting) => {
    state.settings = { [setting]: false };
    const { tabs } = renderedTabs();
    expect(tabs).not.toContain(button);
    expect(tabs).toHaveLength(11);
  });

  it('keeps the rule above Explore and Create Space while one of them shows', () => {
    // Between the joined spaces and that group, and between the scrolling and pinned parts.
    expect(renderedTabs().separators).toBe(2);
    state.settings = { showExploreInSidebar: false };
    expect(renderedTabs().separators).toBe(2);
    state.settings = { showExploreInSidebar: false, showCreateSpaceInSidebar: false };
    expect(renderedTabs().separators).toBe(1);
  });

  it('lets the deployment hide a button whatever the switch says', () => {
    const { tabs } = renderedTabs({ sidebar: { showThreads: false, showExploreCommunity: false } });
    expect(tabs).not.toContain('threads');
    expect(tabs).not.toContain('explore');
    expect(tabs).not.toContain('createSpace');
    expect(renderedTabs({}).tabs).not.toContain('canvases');
    expect(renderedTabs({ sidebar: { showMindRoom: false } }).tabs).not.toContain('localMindroom');
  });
});
