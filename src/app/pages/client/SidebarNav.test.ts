import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../hooks/useClientConfig';
import { SidebarNav } from './SidebarNav';

vi.mock('folds', () => ({
  Scroll: React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) =>
    React.createElement('div', { ref }, children)
  ),
}));

vi.mock('../../components/sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) =>
    React.createElement('nav', null, children),
  SidebarContent: ({
    scrollable,
    sticky,
  }: {
    scrollable: React.ReactNode;
    sticky: React.ReactNode;
  }) => React.createElement('div', null, scrollable, sticky),
  SidebarStackSeparator: () => React.createElement('hr'),
  SidebarStack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('./sidebar', () => ({
  DirectTab: () => React.createElement('div', { 'data-tab': 'direct' }),
  HomeTab: () => React.createElement('div', { 'data-tab': 'home' }),
  SpaceTabs: () => React.createElement('div', { 'data-tab': 'spaces' }),
  InboxTab: () => React.createElement('div', { 'data-tab': 'inbox' }),
  ExploreTab: () => React.createElement('div', { 'data-tab': 'explore' }),
  SettingsTab: () => React.createElement('div', { 'data-tab': 'settings' }),
  UnverifiedTab: () => React.createElement('div', { 'data-tab': 'unverified' }),
  SearchTab: () => React.createElement('div', { 'data-tab': 'search' }),
  ThreadsTab: () => React.createElement('div', { 'data-tab': 'threads' }),
}));

vi.mock('./sidebar/CreateTab', () => ({
  CreateTab: () => React.createElement('div', { 'data-tab': 'create' }),
}));

vi.mock('../../mindroom/sidebar/MindroomTab', () => ({
  MindroomTab: () => React.createElement('div', { 'data-tab': 'mindroom' }),
}));

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
  it('shows the Threads tab by default', () => {
    const renderer = renderSidebarNav();

    expect(hasTab(renderer, 'threads')).toBe(true);

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

  it('renders an optional footer below the sticky navigation stack', () => {
    const renderer = renderSidebarNav(
      {},
      React.createElement('button', { 'aria-label': 'Hide sidebar' })
    );

    expect(renderer.root.findAllByProps({ 'aria-label': 'Hide sidebar' })).toHaveLength(1);

    renderer.unmount();
  });
});
