import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { commandPaletteOpenAtom } from '../../../mindroom/command-palette/commandPaletteState';
import { SearchTab } from './SearchTab';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Icon: ({ src }: { src: string }) => reactModule.createElement('i', { 'data-icon': src }),
    Icons: {
      Terminal: 'Terminal',
    },
  };
});

vi.mock('../../../components/sidebar', () => ({
  SidebarItem: ({
    active,
    children,
  }: {
    active?: boolean;
    children: React.ReactNode;
  }) => React.createElement('div', { 'data-active': active }, children),
  SidebarItemTooltip: ({
    tooltip,
    children,
  }: {
    tooltip: string;
    children: (triggerRef: () => void) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      {
        'data-tooltip': tooltip,
      },
      children(() => undefined)
    ),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: React.ReactNode;
    }
  >(({ children, ...props }, ref) =>
    React.createElement('button', { ref, type: 'button', ...props }, children)
  ),
}));

const renderSearchTab = (open = false) => {
  const store = createStore();
  store.set(commandPaletteOpenAtom, open);

  const renderer = create(
    React.createElement(
      Provider,
      { store },
      React.createElement(SearchTab)
    )
  );

  return { renderer, store };
};

describe('SearchTab', () => {
  it('opens the shared command palette atom from the sidebar trigger', async () => {
    const { renderer, store } = renderSearchTab(false);
    const button = renderer.root.findByType('button');

    await act(async () => {
      button.props.onClick();
    });

    expect(store.get(commandPaletteOpenAtom)).toBe(true);
  });

  it('uses the command palette tooltip and active state', () => {
    const { renderer } = renderSearchTab(true);

    expect(renderer.root.findByProps({ 'data-tooltip': 'Open command palette' })).toBeDefined();
    expect(renderer.root.findByProps({ 'data-active': true })).toBeDefined();
    expect(renderer.root.findByProps({ 'data-icon': 'Terminal' })).toBeDefined();
  });
});
