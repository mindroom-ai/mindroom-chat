import React from 'react';
import { create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { SidebarNav } from './SidebarNav';

const mocks = vi.hoisted(() => ({
  showCanvases: true,
  homeserverUrl: 'https://mindroom.chat',
}));

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
  CanvasesTab: () => React.createElement('div', { 'data-tab': 'canvases' }),
}));
vi.mock('./rail/DirectTab', () => ({
  DirectTab: () => React.createElement('div', { 'data-tab': 'direct' }),
}));
vi.mock('./rail/ExploreTab', () => ({
  ExploreTab: () => React.createElement('div', { 'data-tab': 'explore' }),
}));
vi.mock('./rail/HomeTab', () => ({
  HomeTab: () => React.createElement('div', { 'data-tab': 'home' }),
}));
vi.mock('./rail/ActivityTab', () => ({
  ActivityTab: () => React.createElement('div', { 'data-tab': 'activity' }),
}));
vi.mock('../command-palette/CommandPaletteSidebarTab', () => ({
  SearchTab: () => React.createElement('div', { 'data-tab': 'search' }),
}));
vi.mock('./rail/SettingsTab', () => ({
  SettingsTab: () => React.createElement('div', { 'data-tab': 'settings' }),
}));
vi.mock('./rail/SpaceTabs', () => ({
  SpaceTabs: () => React.createElement('div', { 'data-tab': 'spaces' }),
}));
vi.mock('./rail/ThreadsTab', () => ({
  ThreadsTab: () => React.createElement('div', { 'data-tab': 'threads' }),
}));
vi.mock('../account/switcher/UnverifiedTab', () => ({
  UnverifiedTab: () => React.createElement('div', { 'data-tab': 'unverified' }),
}));

vi.mock('./rail/CreateTab', () => ({
  CreateTab: () => React.createElement('div', { 'data-tab': 'create' }),
}));

vi.mock('./rail/LocalMindroomTab', () => ({
  LocalMindroomTab: () => React.createElement('div', { 'data-tab': 'mindroom' }),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => mocks.homeserverUrl,
    getAccessToken: () => 'token',
  }),
}));

vi.mock('../matrix/hooks/useAccountSettings', async () => {
  const { DEFAULT_MINDROOM_ACCOUNT_SETTINGS } = await import(
    '../preferences/accountSettings'
  );
  // An account that turned its rail buttons on; SidebarNav.buttons.test.tsx covers the defaults.
  return {
    useAccountSettings: () => ({
      ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
      showThreadsInSidebar: true,
      showExploreInSidebar: true,
      showLocalMindroomInSidebar: true,
      showCanvasesInSidebar: mocks.showCanvases,
    }),
  };
});

const renderSidebarNav = (clientConfig: ClientConfig = {}, footer?: React.ReactNode) =>
  create(
    React.createElement(
      ClientConfigProvider,
      { value: clientConfig },
      React.createElement(SidebarNav, { footer })
    )
  );

const hasTab = (renderer: ReturnType<typeof renderSidebarNav>, tab: string): boolean =>
  renderer.root.findAll((node) => node.props['data-tab'] === tab).length > 0;

describe('SidebarNav', () => {
  beforeEach(() => {
    mocks.showCanvases = true;
    mocks.homeserverUrl = 'https://mindroom.chat';
  });

  it('shows Activity after Direct Messages, then Threads, before spaces', () => {
    const renderer = renderSidebarNav();

    expect(
      renderer.root
        .findAll((node) => typeof node.props['data-tab'] === 'string')
        .map((node) => node.props['data-tab'])
        .slice(0, 5)
    ).toEqual(['home', 'direct', 'activity', 'threads', 'spaces']);

    renderer.unmount();
  });

  it('hides the Threads tab when sidebar.showThreads is false', () => {
    const renderer = renderSidebarNav({
      sidebar: {
        showThreads: false,
      },
    });

    expect(hasTab(renderer, 'threads')).toBe(false);

    renderer.unmount();
  });

  it('shows Canvases after Threads where canvases are on', () => {
    const canvases = { mindroom: { canvas: { enabled: true } } };
    const renderer = renderSidebarNav(canvases);
    expect(
      renderer.root
        .findAll((node) => typeof node.props['data-tab'] === 'string')
        .map((node) => node.props['data-tab'])
        .slice(0, 6)
    ).toEqual(['home', 'direct', 'activity', 'threads', 'canvases', 'spaces']);
    renderer.unmount();

    const off = renderSidebarNav();
    expect(hasTab(off, 'canvases')).toBe(false);
    off.unmount();

    // The user can turn the button off in Settings → General → Interface.
    mocks.showCanvases = false;
    const turnedOff = renderSidebarNav(canvases);
    expect(hasTab(turnedOff, 'canvases')).toBe(false);
    turnedOff.unmount();
  });

  it('keeps Explorer visible in the full interface', () => {
    const cases: [ClientConfig, boolean][] = [
      [{}, true],
      [{ sidebar: {} }, true],
      [{ sidebar: { showExploreCommunity: false } }, false],
      [{ sidebar: { showExploreCommunity: true } }, true],
    ];

    cases.forEach(([config, visible]) => {
      const renderer = renderSidebarNav(config);

      expect(hasTab(renderer, 'explore')).toBe(visible);

      renderer.unmount();
    });
  });

  it('shows Local MindRoom only for accounts on the provisioning homeserver', () => {
    const config = { sidebar: { mindRoomProvisioningUrl: 'https://mindroom.chat' } };
    const onProvisioningServer = renderSidebarNav(config);
    expect(hasTab(onProvisioningServer, 'mindroom')).toBe(true);
    onProvisioningServer.unmount();

    mocks.homeserverUrl = 'https://matrix.example.org';
    const elsewhere = renderSidebarNav(config);
    expect(hasTab(elsewhere, 'mindroom')).toBe(false);
    elsewhere.unmount();

    // Without a provisioning URL, every homeserver provisions its own accounts.
    const ownProvisioning = renderSidebarNav();
    expect(hasTab(ownProvisioning, 'mindroom')).toBe(true);
    ownProvisioning.unmount();
  });

  it('renders an optional footer below the sticky navigation stack', () => {
    const renderer = renderSidebarNav(
      {},
      React.createElement('button', { 'aria-label': 'Collapse navigation panel' })
    );

    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Collapse navigation panel' })
    ).toHaveLength(1);

    renderer.unmount();
  });
});
