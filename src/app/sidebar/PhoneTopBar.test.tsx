import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { PhoneTopBar } from './PhoneTopBar';

const unread = vi.hoisted(() => ({
  value: undefined as undefined | { total: number; highlight: number },
}));
const activity = vi.hoisted(() => ({ badge: { count: 0, needsYou: false } }));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../lib/user-agent', () => ({ isMacOS: () => false, isIOS: () => false }));
vi.mock('../matrix/state/useUnread', () => ({ useRoomsUnread: () => unread.value }));
vi.mock('./rail/SettingsTab', () => ({
  SettingsTab: ({ inTopBar }: { inTopBar?: boolean }) =>
    React.createElement('button', { 'data-account': inTopBar }),
}));
vi.mock('../activity/useActivityRows', () => ({ useActivityBadge: () => activity.badge }));
vi.mock('../activity/ActivitySheet', () => ({
  ActivitySheet: () => React.createElement('section', { 'data-activity-sheet': true }),
}));
vi.mock('./rail/ActivityTab', () => ({
  ActivityBadge: ({ count }: { count: number }) => React.createElement('b', null, String(count)),
}));
vi.mock('./PhoneTopBar.css', () => ({
  PhoneTopBar: 'bar',
  MenuButtonFrame: 'menu',
  UnreadDot: 'dot',
  SearchField: 'search',
  BarControl: 'control',
  BellFrame: 'bell',
  BellBadge: 'bell-badge',
}));
vi.mock('../command-palette/CommandPaletteSearchField.css', () => ({
  SearchField: 'field',
  SearchPlaceholder: 'placeholder',
}));
vi.mock('folds', async () => {
  const reactModule = await import('react');
  const element =
    (tag: string) =>
    ({ as, children, ...rest }: { as?: string; children?: React.ReactNode }) =>
      reactModule.createElement(as ?? tag, rest, children);
  return {
    Badge: element('span'),
    Icon: () => reactModule.createElement('i'),
    IconButton: element('button'),
    Icons: { Search: 'Search', Bell: 'Bell' },
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const renderBar = () => {
  const store = createStore();
  const renderer = create(
    <Provider store={store}>
      <PhoneTopBar />
    </Provider>
  );
  // By its label, or by its text, as the search field is named.
  const button = (name: string) =>
    renderer.root.find(
      (node) =>
        node.type === 'button' &&
        (node.props['aria-label'] === name ||
          (!node.props['aria-label'] && textOf(node).startsWith(name)))
    );
  return { store, renderer, button };
};

describe('PhoneTopBar', () => {
  it('shows a search field that names the shortcut and opens the palette', () => {
    const { store, button } = renderBar();
    const search = button('Find anything');
    expect(textOf(search)).toContain('Ctrl + K');
    expect(search.props['aria-keyshortcuts']).toBe('Control+K');
    act(() => {
      search.props.onClick();
    });
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
  });

  it('opens and closes the drawer with the menu button', () => {
    const { store, button } = renderBar();
    act(() => {
      button('Navigation').props.onClick();
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    const close = button('Navigation');
    expect(close.props['aria-expanded']).toBe(true);
    expect(close.props['aria-controls']).toBe('phone-nav-drawer');
    act(() => {
      close.props.onClick();
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
  });

  it('marks unread messages on the menu button, as a mention when one is', () => {
    unread.value = undefined;
    expect(
      renderBar().renderer.root.findAll(
        (node) => node.type === 'span' && 'data-highlight' in node.props
      )
    ).toHaveLength(0);
    // A room with unread messages but nothing that notifies still shows the dot.
    unread.value = { total: 0, highlight: 0 };
    expect(
      renderBar().renderer.root.findAll(
        (node) => node.type === 'span' && 'data-highlight' in node.props
      )
    ).toHaveLength(1);
    unread.value = { total: 3, highlight: 1 };
    const [dot] = renderBar().renderer.root.findAll(
      (node) => node.type === 'span' && 'data-highlight' in node.props
    );
    expect(dot?.props['data-highlight']).toBe(true);
  });

  it('opens Activity as a sheet from the bell, which counts the unread rows', () => {
    activity.badge = { count: 2, needsYou: false };
    const { renderer, button } = renderBar();
    const bell = button('Activity, 2 unread');
    expect(bell.props['aria-expanded']).toBe(false);
    expect(
      renderer.root.findAll((node) => node.props['data-activity-sheet'] === true)
    ).toHaveLength(0);
    act(() => {
      bell.props.onClick();
    });
    expect(
      renderer.root.findAll((node) => node.props['data-activity-sheet'] === true)
    ).toHaveLength(1);
    activity.badge = { count: 0, needsYou: false };
  });

  it('puts the account at the end of the bar', () => {
    const { renderer } = renderBar();
    expect(renderer.root.find((node) => node.props['data-account'] === true)).toBeTruthy();
  });
});
