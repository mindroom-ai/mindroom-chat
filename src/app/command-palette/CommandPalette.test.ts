import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandPaletteSource } from './commandPaletteItems';
import { CommandPalette } from './CommandPalette';
import type { CommandPaletteMessages } from './useCommandPaletteMessages';
import type { CommandPalettePeople } from './useCommandPalettePeople';

const { searchCommandPaletteSectionCalls } = vi.hoisted(() => ({
  searchCommandPaletteSectionCalls: vi.fn(),
}));

vi.mock('../lib/user-agent', () => ({
  isMacOS: () => false,
  isIOS: () => false,
}));

vi.mock('./commandPaletteSearch', async () => {
  const actual = await vi.importActual<typeof import('./commandPaletteSearch')>(
    './commandPaletteSearch'
  );

  return {
    ...actual,
    searchCommandPaletteSection: vi.fn((options) => {
      searchCommandPaletteSectionCalls(options);
      return actual.searchCommandPaletteSection(options);
    }),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    toRem: (value: number) => `${value / 16}rem`,
    Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', props, children),
    Icon: ({ src, ...props }: React.HTMLAttributes<HTMLSpanElement> & { src?: string }) =>
      reactModule.createElement('span', { ...props, 'data-icon-src': src }),
    IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    Input: ({
      value,
      onChange,
      onKeyDown,
      ...props
    }: React.InputHTMLAttributes<HTMLInputElement>) =>
      reactModule.createElement('input', { value, onChange, onKeyDown, ...props }),
    Scroll: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', { 'data-testid': 'scroll', ...props }, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', { 'data-avatar': true }, children),
    AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) =>
      reactModule.createElement('img', props),
    AvatarFallback: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Line: () => reactModule.createElement('hr'),
    Spinner: () => reactModule.createElement('span', { 'data-spinner': true }),
    Icons: {
      Cross: 'cross',
      Terminal: 'terminal',
      Message: 'message',
      Hash: 'hash',
      Space: 'space',
      User: 'user',
      Search: 'search',
    },
    color: {
      Warning: { Main: 'warning-main' },
      Primary: { Main: 'primary-main' },
      Success: { Main: 'success-main' },
      Secondary: { Main: 'secondary-main' },
      SurfaceVariant: {
        OnContainer: 'surface-variant-on-container',
        ContainerHover: 'surface-variant-container-hover',
      },
    },
    config: {
      space: {
        S400: '16px',
      },
    },
  };
});

vi.mock('../i18n/useRelativeTime', () => ({
  useRelativeTime: () => '2h',
}));

vi.mock('./CommandPalette.css', () => ({
  Palette: 'Palette',
  Search: 'Search',
  Input: 'Input',
  Close: 'Close',
  Tabs: 'Tabs',
  Tab: 'Tab',
  ClearSearch: 'ClearSearch',
  Results: 'Results',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  GroupCount: 'GroupCount',
  Row: 'Row',
  RowIcon: 'RowIcon',
  RowAvatar: 'RowAvatar',
  RowText: 'RowText',
  RowHeading: 'RowHeading',
  RowTitle: 'RowTitle',
  RowPlace: 'RowPlace',
  RowTime: 'RowTime',
  Tag: 'Tag',
  Match: 'Match',
  Note: 'Note',
  RowDescription: 'RowDescription',
  RowEnter: 'RowEnter',
  Key: 'Key',
  Footer: 'Footer',
  KeyboardHints: 'KeyboardHints',
  Hint: 'Hint',
  Empty: 'Empty',
  EmptyTitle: 'EmptyTitle',
  EmptyDescription: 'EmptyDescription',
}));

const getInput = (renderer: ReturnType<typeof create>) => renderer.root.findByType('input');
const getOptions = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => node.props.role === 'option');
const FIXTURE_SOURCE: CommandPaletteSource = {
  actions: [
    {
      id: 'action-settings',
      kind: 'action',
      title: 'Open Settings',
      description: 'Shared settings modal',
      keywords: ['preferences'],
      sortRank: 30,
    },
    {
      id: 'action-home',
      kind: 'action',
      title: 'Go Home',
      description: 'Jump back to the home view',
      keywords: ['home'],
      sortRank: 20,
    },
    {
      id: 'action-theme',
      kind: 'action',
      title: 'Toggle Theme',
      description: 'Switch between light and dark',
      keywords: ['theme', 'appearance'],
      sortRank: 10,
    },
  ],
  rooms: [
    {
      id: '!general:example.org',
      kind: 'room',
      name: 'General',
      topic: 'Team chat',
      parentNames: ['MindRoom'],
      sortRank: 30,
      boost: 30,
    },
    {
      id: '!product:example.org',
      kind: 'room',
      name: 'Product',
      topic: 'Roadmap planning',
      parentNames: ['MindRoom'],
      sortRank: 20,
      boost: 20,
    },
    {
      id: '!space:example.org',
      kind: 'space',
      name: 'Engineering Space',
      topic: 'Nested engineering rooms',
      sortRank: 10,
      boost: 10,
    },
  ],
  getUsers: vi.fn<CommandPaletteSource['getUsers']>(() => [
    {
      id: '@alice:example.org',
      kind: 'user',
      displayName: 'Alice',
      userId: '@alice:example.org',
      localpart: 'alice',
      dmRoomName: 'Alice DM',
      sortRank: 30,
      boost: 30,
    },
    {
      id: '@bob:example.org',
      kind: 'user',
      displayName: 'Bob',
      userId: '@bob:example.org',
      localpart: 'bob',
      dmRoomName: 'Bob DM',
      sortRank: 20,
      boost: 20,
    },
  ]),
  threads: [
    {
      id: '$thread-incident',
      kind: 'thread',
      roomId: '!general:example.org',
      threadId: '$thread-incident',
      summaryText: 'Investigate login incident',
      roomName: 'General',
      participantNames: ['Alice', 'Bob'],
      tags: ['urgent'],
      sortRank: 30,
      boost: 30,
    },
    {
      id: '$thread-release',
      kind: 'thread',
      roomId: '!product:example.org',
      threadId: '$thread-release',
      summaryText: 'Ship release checklist',
      roomName: 'Product',
      participantNames: ['Carmen'],
      tags: ['release'],
      sortRank: 20,
      boost: 20,
    },
  ],
};

// What the server search reports; tests change it and render again to deliver results.
const messageState: { current: CommandPaletteMessages } = {
  current: {
    status: 'idle',
    items: [],
    encryptedRooms: false,
    openSearchPage: vi.fn(),
  },
};
const useMessages = vi.fn((text: string, enabled: boolean): CommandPaletteMessages => {
  void text;
  void enabled;
  return messageState.current;
});

const setMessages = (change: Partial<CommandPaletteMessages>) => {
  messageState.current = { ...messageState.current, ...change };
};

const messageHit = (n: number) => ({
  id: `message:!general:example.org:$hit${n}`,
  kind: 'message' as const,
  senderName: 'Alice',
  roomName: 'General',
  snippet: `walrus sighting number ${n}`,
  highlights: ['walrus'],
  timestamp: 1_700_000_000_000 + n,
  onSelect: vi.fn(),
});

// What the user directory reports, changed the same way.
const peopleState: { current: CommandPalettePeople } = { current: { status: 'idle', items: [] } };
const usePeople = vi.fn((text: string, enabled: boolean): CommandPalettePeople => {
  void text;
  void enabled;
  return peopleState.current;
});

const setPeople = (change: Partial<CommandPalettePeople>) => {
  peopleState.current = { ...peopleState.current, ...change };
};

/** Someone only the server knows, who has no direct chat with the account yet. */
const serverPerson = (name: string, change: Partial<CommandPalettePeople['items'][number]> = {}) => {
  const localpart = name.toLowerCase();
  return {
    id: `user:@${localpart}:example.org`,
    kind: 'user' as const,
    displayName: name,
    userId: `@${localpart}:example.org`,
    localpart,
    startChat: vi.fn(async () => undefined),
    ...change,
  };
};

beforeEach(() => {
  messageState.current = {
    status: 'idle',
    items: [],
    encryptedRooms: false,
    openSearchPage: vi.fn(),
  };
  useMessages.mockClear();
  peopleState.current = { status: 'idle', items: [] };
  usePeople.mockClear();
});

const paletteElement = (props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) =>
  React.createElement(CommandPalette, {
    requestClose: vi.fn(),
    source: FIXTURE_SOURCE,
    useMessages,
    usePeople,
    ...props,
  });

const renderPalette = (props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) =>
  create(paletteElement(props));

const type = async (renderer: ReturnType<typeof create>, value: string) =>
  act(async () => getInput(renderer).props.onChange({ currentTarget: { value } }));

// A key in the field, with the caret at `caret` (default: the end of the text).
const press = async (
  renderer: ReturnType<typeof create>,
  key: string,
  { caret, shiftKey = false }: { caret?: number; shiftKey?: boolean } = {}
) => {
  const value: string = getInput(renderer).props.value;
  const at = caret ?? value.length;
  const event = {
    key,
    shiftKey,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    currentTarget: { value, selectionStart: at, selectionEnd: at },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  await act(async () => getInput(renderer).props.onKeyDown(event));
  return event;
};

const getTabs = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props.role === 'tab');
const selectedTab = (renderer: ReturnType<typeof create>) =>
  getTabs(renderer).find((tab) => tab.props['aria-selected'])?.props['data-tab'];
const selectedId = (renderer: ReturnType<typeof create>) =>
  getOptions(renderer).find((option) => option.props['aria-selected'])?.props['data-item-id'];
const optionIds = (renderer: ReturnType<typeof create>) =>
  getOptions(renderer).map((option) => option.props['data-item-id']);

describe('CommandPalette', () => {
  it('shows a tab row with All, Rooms, Threads, People, Messages and Actions', () => {
    const renderer = renderPalette();
    const tablist = renderer.root.findByProps({ role: 'tablist' });
    expect(tablist.props['aria-label']).toBe('Result types');
    expect(getTabs(renderer).map((tab) => tab.children.join(''))).toEqual([
      'All',
      'Rooms',
      'Threads',
      'People',
      'Messages',
      'Actions',
    ]);
    expect(selectedTab(renderer)).toBe('all');
    const panel = renderer.root.findByProps({ role: 'tabpanel' });
    const allTab = getTabs(renderer)[0];
    expect(panel.props['aria-labelledby']).toBe(allTab?.props.id);
    expect(allTab?.props['aria-controls']).toBe(panel.props.id);
  });

  it('opens on the tab it is given, such as Messages from the search shortcut', () => {
    const renderer = renderPalette({ initialTab: 'messages' });
    expect(selectedTab(renderer)).toBe('messages');
    expect(useMessages).toHaveBeenLastCalledWith('', true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Type to search messages in all your rooms.');
  });

  it('switches tabs with Tab and Shift+Tab and keeps focus in the field', async () => {
    const renderer = renderPalette();
    await type(renderer, 'gen');
    const tab = await press(renderer, 'Tab', { caret: 1 });
    expect(selectedTab(renderer)).toBe('rooms');
    expect(tab.preventDefault).toHaveBeenCalled();
    // The dialog's focus containment must not see the key.
    expect(tab.stopPropagation).toHaveBeenCalled();
    await press(renderer, 'Tab', { shiftKey: true });
    await press(renderer, 'Tab', { shiftKey: true });
    expect(selectedTab(renderer)).toBe('actions');
    expect(getInput(renderer).props.value).toBe('gen');
  });

  it('switches tabs with the arrows while the query is empty', async () => {
    const renderer = renderPalette();
    await press(renderer, 'ArrowRight');
    await press(renderer, 'ArrowRight');
    expect(selectedTab(renderer)).toBe('threads');
    await press(renderer, 'ArrowLeft');
    expect(selectedTab(renderer)).toBe('rooms');
  });

  it('moves the caret with left in the middle of typed text instead of switching', async () => {
    const renderer = renderPalette();
    await type(renderer, 'General');
    const left = await press(renderer, 'ArrowLeft', { caret: 3 });
    expect(selectedTab(renderer)).toBe('all');
    expect(left.preventDefault).not.toHaveBeenCalled();
    await press(renderer, 'ArrowRight', { caret: 0 });
    expect(selectedTab(renderer)).toBe('all');
    // At the edges of the text the arrows switch.
    await press(renderer, 'ArrowRight', { caret: 7 });
    expect(selectedTab(renderer)).toBe('rooms');
    await press(renderer, 'ArrowLeft', { caret: 0 });
    expect(selectedTab(renderer)).toBe('all');
  });

  it('switches with the arrows after the up or down arrow, until the text is edited', async () => {
    const renderer = renderPalette();
    await type(renderer, 'e');
    await press(renderer, 'ArrowDown');
    await press(renderer, 'ArrowLeft', { caret: 0 });
    await press(renderer, 'ArrowLeft', { caret: 1 });
    expect(selectedTab(renderer)).toBe('messages');
    await press(renderer, 'ArrowRight', { caret: 0 });
    expect(selectedTab(renderer)).toBe('actions');
    await press(renderer, 'x');
    await press(renderer, 'ArrowLeft', { caret: 1 });
    expect(selectedTab(renderer)).toBe('actions');
  });

  it('switches tabs by click without losing the search text', async () => {
    const renderer = renderPalette();
    await type(renderer, 'General');
    const roomsTab = getTabs(renderer).find((tab) => tab.props['data-tab'] === 'rooms');
    await act(async () => roomsTab?.props.onClick());
    expect(getInput(renderer).props.value).toBe('General');
    expect(selectedTab(renderer)).toBe('rooms');
    expect(getOptions(renderer).every((option) => option.props['data-kind'] === 'room')).toBe(
      true
    );
  });

  it('lists spaces, marked as spaces, on the Rooms tab', async () => {
    const renderer = renderPalette({ initialTab: 'rooms' });
    const kinds = getOptions(renderer).map((option) => option.props['data-kind']);
    expect(kinds).toEqual(['room', 'room', 'space']);
  });

  it('keeps spaces out of the starter rooms on All so Enter switches to a room', async () => {
    const renderer = renderPalette({
      source: {
        ...FIXTURE_SOURCE,
        rooms: FIXTURE_SOURCE.rooms.map((room) =>
          room.kind === 'space' ? { ...room, sortRank: 99 } : room
        ),
      },
    });
    expect(getOptions(renderer)[0]?.props['data-item-id']).toBe('!general:example.org');
    expect(getOptions(renderer).some((option) => option.props['data-kind'] === 'space')).toBe(
      false
    );
    await type(renderer, 'Engineering');
    expect(getOptions(renderer)[0]?.props['data-kind']).toBe('space');
  });

  it('renders the starter sections for an empty query, rooms first and no messages', () => {
    vi.mocked(FIXTURE_SOURCE.getUsers).mockClear();
    const renderer = renderPalette();
    const groups = renderer.root.findAll(
      (node) => node.props.role === 'group' && node.props['data-section']
    );
    expect(groups.map((group) => group.props['data-section'])).toEqual([
      'rooms',
      'threads',
      'actions',
      'users',
    ]);
    expect(getOptions(renderer)[0]?.props['data-selected']).toBe(true);
    expect(FIXTURE_SOURCE.getUsers).toHaveBeenCalledWith({
      exhaustive: false,
      includeRelatedRooms: false,
    });
  });

  it('shows the top few of each section on All and the rest on its own tab', async () => {
    const actions = Array.from({ length: 6 }, (_, n) => ({
      id: `action-${n}`,
      kind: 'action' as const,
      title: `Action ${n}`,
      sortRank: 10 - n,
    }));
    const renderer = renderPalette({ source: { ...FIXTURE_SOURCE, actions } });
    expect(optionIds(renderer).filter((id) => id.startsWith('action-'))).toHaveLength(3);
    await press(renderer, 'Tab', { shiftKey: true });
    expect(selectedTab(renderer)).toBe('actions');
    expect(optionIds(renderer)).toHaveLength(6);
  });

  it('asks People for related-room users on its tab and for any typed search', async () => {
    vi.mocked(FIXTURE_SOURCE.getUsers).mockClear();
    const renderer = renderPalette({ initialTab: 'users' });
    expect(FIXTURE_SOURCE.getUsers).toHaveBeenLastCalledWith({
      exhaustive: false,
      includeRelatedRooms: true,
    });
    await type(renderer, 'ali');
    expect(FIXTURE_SOURCE.getUsers).toHaveBeenLastCalledWith({
      exhaustive: true,
      includeRelatedRooms: true,
    });
    expect(getOptions(renderer).map((option) => option.props['data-kind'])).toEqual(['user']);
  });

  it('only searches the active section on a single-section tab', async () => {
    const renderer = renderPalette({ initialTab: 'users' });
    searchCommandPaletteSectionCalls.mockClear();
    await type(renderer, 'alice');
    expect(searchCommandPaletteSectionCalls).toHaveBeenCalledTimes(1);
    expect(
      searchCommandPaletteSectionCalls.mock.calls[0]?.[0]?.items.every(
        (item: { kind: string }) => item.kind === 'user'
      )
    ).toBe(true);
  });

  it('asks the server only while messages are on screen', async () => {
    const renderer = renderPalette();
    await type(renderer, 'walrus');
    expect(useMessages).toHaveBeenLastCalledWith('walrus', true);
    await press(renderer, 'Tab');
    expect(useMessages).toHaveBeenLastCalledWith('walrus', false);
    await press(renderer, 'Tab', { shiftKey: true });
    await press(renderer, 'Tab', { shiftKey: true });
    await press(renderer, 'Tab', { shiftKey: true });
    expect(selectedTab(renderer)).toBe('messages');
    expect(useMessages).toHaveBeenLastCalledWith('walrus', true);
  });

  it('shows local results at once, with only a quiet loading line for messages', async () => {
    const renderer = renderPalette();
    setMessages({ status: 'loading' });
    await type(renderer, 'e');
    const sections = renderer.root
      .findAll((node) => node.props.role === 'group' && node.props['data-section'])
      .map((group) => group.props['data-section']);
    expect(sections.at(-1)).toBe('messages');
    expect(sections.length).toBeGreaterThan(1);
    const loading = renderer.root.findByProps({ 'data-note': 'loading' });
    expect(loading.findAllByProps({ 'data-spinner': true })).toHaveLength(1);
    expect(
      getOptions(renderer).filter((option) => option.props['data-kind'] === 'message')
    ).toHaveLength(0);
  });

  it('keeps the highlighted row and the rows above it when message results arrive', async () => {
    const renderer = renderPalette();
    setMessages({ status: 'loading' });
    await type(renderer, 'e');
    await press(renderer, 'ArrowDown');
    const highlighted = selectedId(renderer);
    const before = optionIds(renderer);
    expect(highlighted).toBe(before[1]);

    setMessages({ status: 'done', items: [messageHit(1), messageHit(2)] });
    await act(async () => renderer.update(paletteElement()));

    expect(selectedId(renderer)).toBe(highlighted);
    expect(optionIds(renderer).slice(0, before.length)).toEqual(before);
    expect(optionIds(renderer).slice(before.length)).toEqual([
      'message:!general:example.org:$hit1',
      'message:!general:example.org:$hit2',
      'search-page',
    ]);
  });

  it('highlights the first hit when results arrive on an empty Messages tab', async () => {
    const renderer = renderPalette({ initialTab: 'messages' });
    setMessages({ status: 'loading' });
    await type(renderer, 'walrus');
    expect(getOptions(renderer)).toHaveLength(0);
    expect(getInput(renderer).props['aria-activedescendant']).toBeUndefined();

    setMessages({ status: 'done', items: [messageHit(1), messageHit(2)] });
    await act(async () => renderer.update(paletteElement({ initialTab: 'messages' })));
    expect(selectedId(renderer)).toBe('message:!general:example.org:$hit1');
    await press(renderer, 'Enter');
    expect(messageState.current.items[0]?.onSelect).toHaveBeenCalledOnce();
  });

  it('ends the messages with See all results, which opens the search page', async () => {
    const requestClose = vi.fn();
    const renderer = renderPalette({ initialTab: 'messages', requestClose });
    setMessages({ status: 'done', items: [messageHit(1)] });
    await type(renderer, ' walrus ');
    expect(optionIds(renderer).at(-1)).toBe('search-page');
    // The count in the footer leaves out See all results.
    expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['1 result']);
    await press(renderer, 'ArrowUp');
    await press(renderer, 'Enter');
    expect(messageState.current.openSearchPage).toHaveBeenCalledWith('walrus');
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('shows a search error as one quiet line and keeps the other results', async () => {
    const renderer = renderPalette();
    setMessages({ status: 'error' });
    await type(renderer, 'General');
    expect(renderer.root.findByProps({ 'data-note': 'error' }).children).toContain(
      'Search failed. Try again.'
    );
    expect(optionIds(renderer)[0]).toBe('!general:example.org');
  });

  it('says that encrypted rooms are not searched only when the user is in some', async () => {
    const renderer = renderPalette({ initialTab: 'messages' });
    expect(renderer.root.findAllByProps({ 'data-note': 'encrypted' })).toHaveLength(0);
    setMessages({ encryptedRooms: true });
    await act(async () => renderer.update(paletteElement({ initialTab: 'messages' })));
    expect(renderer.root.findByProps({ 'data-note': 'encrypted' }).children).toContain(
      "The server can't search encrypted rooms."
    );
  });

  it('exposes the keyboard selection to assistive technology', async () => {
    const renderer = renderPalette();
    const input = getInput(renderer);
    expect(input.props.role).toBe('combobox');
    const list = renderer.root.findByProps({ role: 'listbox' });
    expect(input.props['aria-controls']).toBe(list.props.id);
    const selected = () => renderer.root.findByProps({ role: 'option', 'aria-selected': true });
    expect(getInput(renderer).props['aria-activedescendant']).toBe(selected().props.id);
    const firstId = selected().props.id;
    await press(renderer, 'ArrowDown');
    expect(selected().props.id).not.toBe(firstId);
    expect(getInput(renderer).props['aria-activedescendant']).toBe(selected().props.id);
  });

  it('moves the selected row with the arrows and wraps around', async () => {
    const renderer = renderPalette({ initialTab: 'rooms' });
    expect(selectedId(renderer)).toBe(optionIds(renderer)[0]);
    await press(renderer, 'ArrowDown');
    expect(selectedId(renderer)).toBe(optionIds(renderer)[1]);
    await press(renderer, 'ArrowUp');
    await press(renderer, 'ArrowUp');
    expect(selectedId(renderer)).toBe(optionIds(renderer).at(-1));
  });

  it('executes the hovered result when Enter is pressed', async () => {
    const onSelect = vi.fn();
    const renderer = renderPalette({
      source: {
        ...FIXTURE_SOURCE,
        actions: [{ id: 'hover-action', kind: 'action', title: 'Hover me', onSelect }],
      },
    });
    const row = renderer.root.findByProps({ 'data-item-id': 'hover-action' });
    await act(async () => row.props.onPointerMove({ pointerType: 'mouse' }));
    await press(renderer, 'Enter');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not execute a result while confirming composed text', async () => {
    const requestClose = vi.fn();
    const renderer = renderPalette({ requestClose });
    await act(async () =>
      getInput(renderer).props.onKeyDown({
        key: 'Enter',
        nativeEvent: { isComposing: true },
        preventDefault: vi.fn(),
      })
    );
    expect(requestClose).not.toHaveBeenCalled();
  });

  it('closes the shell when the selected item is chosen with Enter, and on Escape', async () => {
    const requestClose = vi.fn();
    const renderer = renderPalette({ requestClose });
    await press(renderer, 'Enter');
    expect(requestClose).toHaveBeenCalledTimes(1);
    await press(renderer, 'Escape');
    expect(requestClose).toHaveBeenCalledTimes(2);
  });

  it('clears a search without results back to the starter results', async () => {
    const renderer = renderPalette({ initialTab: 'actions' });
    await type(renderer, 'zxqnotfound');
    expect(getOptions(renderer)).toHaveLength(0);
    expect(getInput(renderer).props['aria-activedescendant']).toBeUndefined();
    const clear = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Clear search'
    );
    await act(async () => clear.props.onClick());
    expect(getInput(renderer).props.value).toBe('');
    expect(getOptions(renderer).length).toBeGreaterThan(0);
  });
});

// Every text inside a row, joined with spaces.
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join(' ');

const peopleSection = (renderer: ReturnType<typeof create>) =>
  renderer.root.find((node) => node.type === 'div' && node.props['data-section'] === 'users');

// The rows and quiet lines of People, in the order they are on screen.
const peopleLines = (renderer: ReturnType<typeof create>) =>
  peopleSection(renderer)
    .findAll(
      (node) =>
        typeof node.type === 'string' && (node.props.role === 'option' || !!node.props['data-note'])
    )
    .map((node) => node.props['data-item-id'] ?? `note:${node.props['data-note']}`);

describe('CommandPalette people from the server', () => {
  it('asks the directory only while People is on screen', async () => {
    const renderer = renderPalette();
    await type(renderer, 'quentin');
    expect(usePeople).toHaveBeenLastCalledWith('quentin', true);
    await press(renderer, 'Tab');
    expect(usePeople).toHaveBeenLastCalledWith('quentin', false);
    await press(renderer, 'Tab');
    await press(renderer, 'Tab');
    expect(selectedTab(renderer)).toBe('users');
    expect(usePeople).toHaveBeenLastCalledWith('quentin', true);
  });

  it('shows local people at once and adds the server ones below without moving the highlight', async () => {
    const renderer = renderPalette({ initialTab: 'users' });
    setPeople({ status: 'loading' });
    await type(renderer, 'example');
    expect(optionIds(renderer)).toEqual(['@alice:example.org', '@bob:example.org']);
    // Only People waits, with a spinner beside its title.
    expect(peopleSection(renderer).props['aria-busy']).toBe(true);
    expect(peopleSection(renderer).findAllByProps({ 'data-spinner': true })).toHaveLength(1);
    await press(renderer, 'ArrowDown');
    expect(selectedId(renderer)).toBe('@bob:example.org');

    setPeople({ status: 'done', items: [serverPerson('Quentin'), serverPerson('Rosa')] });
    await act(async () => renderer.update(paletteElement({ initialTab: 'users' })));
    expect(optionIds(renderer)).toEqual([
      '@alice:example.org',
      '@bob:example.org',
      'user:@quentin:example.org',
      'user:@rosa:example.org',
    ]);
    expect(selectedId(renderer)).toBe('@bob:example.org');
    expect(peopleSection(renderer).props['aria-busy']).toBeUndefined();
    expect(peopleSection(renderer).findAllByProps({ 'data-spinner': true })).toHaveLength(0);
  });

  it('lists nobody twice: the server leaves out the people the palette knows', async () => {
    const renderer = renderPalette({ initialTab: 'users' });
    setPeople({ status: 'done', items: [serverPerson('Alice'), serverPerson('Quentin')] });
    await type(renderer, 'example');
    expect(optionIds(renderer)).toEqual([
      '@alice:example.org',
      '@bob:example.org',
      'user:@quentin:example.org',
    ]);
  });

  it('adds on All only as many as fit, and then a Matrix ID typed in full', async () => {
    const renderer = renderPalette();
    setPeople({
      status: 'done',
      items: [serverPerson('Quentin'), serverPerson('Rosa'), serverPerson('Zed', { typedId: true })],
    });
    await type(renderer, 'example');
    expect(
      getOptions(renderer)
        .filter((option) => option.props['data-kind'] === 'user')
        .map((option) => option.props['data-item-id'])
    ).toEqual([
      '@alice:example.org',
      '@bob:example.org',
      'user:@quentin:example.org',
      'user:@zed:example.org',
    ]);
  });

  it('offers to message a typed Matrix ID, with the name its profile has', async () => {
    const renderer = renderPalette({ initialTab: 'users' });
    setPeople({
      status: 'done',
      items: [serverPerson('Zed', { typedId: true, displayName: 'Zed Zimmer' })],
    });
    await type(renderer, '@zed:example.org');
    const row = renderer.root.findByProps({ role: 'option', 'data-item-id': 'user:@zed:example.org' });
    expect(textOf(row)).toContain('Message @zed:example.org');
    expect(textOf(row)).toContain('Zed Zimmer');
    // Without a profile name the row shows the ID alone.
    setPeople({ status: 'done', items: [serverPerson('Zed', { typedId: true, displayName: 'zed' })] });
    await act(async () => renderer.update(paletteElement({ initialTab: 'users' })));
    const bare = renderer.root.findByProps({ role: 'option', 'data-item-id': 'user:@zed:example.org' });
    expect(textOf(bare)).toContain('Message @zed:example.org');
    expect(bare.findAllByProps({ className: 'RowDescription' })).toHaveLength(0);
  });

  it('shows each person with a picture or their first letter, and marks agents', async () => {
    const renderer = renderPalette({ initialTab: 'users' });
    setPeople({
      status: 'done',
      items: [
        serverPerson('Quentin', { avatarUrl: 'https://example.org/quentin.png' }),
        serverPerson('mindroom_helper', { displayName: 'Helper agent' }),
      ],
    });
    await type(renderer, 'example');
    const quentin = renderer.root.findByProps({ role: 'option', 'data-item-id': 'user:@quentin:example.org' });
    expect(quentin.findByType('img').props.src).toBe('https://example.org/quentin.png');
    expect(textOf(quentin)).not.toContain('Agent');
    const helper = renderer.root.findByProps({
      role: 'option',
      'data-item-id': 'user:@mindroom_helper:example.org',
    });
    expect(helper.findAllByType('img')).toHaveLength(0);
    expect(textOf(helper.findByProps({ 'data-avatar': true }))).toBe('H');
    expect(textOf(helper)).toContain('Agent');
  });

  it('shows a failed directory search as one quiet line after the people', async () => {
    const renderer = renderPalette({ initialTab: 'users' });
    setPeople({ status: 'error', items: [] });
    await type(renderer, 'example');
    expect(peopleLines(renderer)).toEqual([
      '@alice:example.org',
      '@bob:example.org',
      'note:people-error',
    ]);
    expect(renderer.root.findByProps({ 'data-note': 'people-error' }).children).toContain(
      "Couldn't search the server for people."
    );
  });

  it('asks before starting a chat, starts it on Enter, and goes back on Escape', async () => {
    const requestClose = vi.fn();
    const quentin = serverPerson('Quentin');
    const renderer = renderPalette({ initialTab: 'users', requestClose });
    setPeople({ status: 'done', items: [quentin] });
    await type(renderer, 'quentin');
    expect(selectedId(renderer)).toBe('user:@quentin:example.org');

    await press(renderer, 'Enter');
    expect(optionIds(renderer)).toEqual(['start-chat:@quentin:example.org']);
    const question = getOptions(renderer)[0]!;
    expect(question.props['aria-selected']).toBe(true);
    expect(textOf(question)).toContain('Start a chat with Quentin?');
    expect(textOf(question)).toContain('Sends an invite to @quentin:example.org.');
    expect(quentin.startChat).not.toHaveBeenCalled();
    expect(requestClose).not.toHaveBeenCalled();
    // The arrows have nothing else to move to.
    await press(renderer, 'ArrowDown');
    expect(optionIds(renderer)).toEqual(['start-chat:@quentin:example.org']);

    const escape = await press(renderer, 'Escape');
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(requestClose).not.toHaveBeenCalled();
    expect(selectedId(renderer)).toBe('user:@quentin:example.org');
    expect(getInput(renderer).props.value).toBe('quentin');
    expect(quentin.startChat).not.toHaveBeenCalled();

    await press(renderer, 'Enter');
    await press(renderer, 'Enter');
    expect(quentin.startChat).toHaveBeenCalledOnce();
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('starts the chat when the question is clicked, and goes back when the text changes', async () => {
    const requestClose = vi.fn();
    const quentin = serverPerson('Quentin');
    const renderer = renderPalette({ initialTab: 'users', requestClose });
    setPeople({ status: 'done', items: [quentin] });
    await type(renderer, 'quentin');
    const row = renderer.root.findByProps({ role: 'option', 'data-item-id': 'user:@quentin:example.org' });
    await act(async () => row.props.onClick());
    expect(optionIds(renderer)).toEqual(['start-chat:@quentin:example.org']);
    await type(renderer, 'quent');
    expect(optionIds(renderer)).toContain('user:@quentin:example.org');
    await act(async () =>
      renderer.root
        .findByProps({ role: 'option', 'data-item-id': 'user:@quentin:example.org' })
        .props.onClick()
    );
    await act(async () => getOptions(renderer)[0]!.props.onClick());
    expect(quentin.startChat).toHaveBeenCalledOnce();
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('ranks the person whose whole name or user name is typed above people with a direct chat', async () => {
    const localPerson = (name: string, boost: number, dm: boolean) => {
      const localpart = name.toLowerCase().replace(' ', '');
      return {
        id: `user:@${localpart}:example.org`,
        kind: 'user' as const,
        displayName: name,
        userId: `@${localpart}:example.org`,
        localpart,
        ...(dm ? { dmRoomName: name, existingDmRoomId: `!dm-${localpart}:example.org` } : {}),
        boost,
        onSelect: vi.fn(),
      };
    };
    const source: CommandPaletteSource = {
      ...FIXTURE_SOURCE,
      getUsers: vi.fn(() => [
        localPerson('User B', 10, true),
        localPerson('User C', 5, false),
        localPerson('User H', 5, false),
      ]),
    };
    for (const initialTab of ['users', 'all'] as const) {
      const renderer = renderPalette({ initialTab, source });
      await type(renderer, 'User H');
      expect(peopleLines(renderer)[0]).toBe('user:@userh:example.org');
      await type(renderer, 'userh');
      expect(peopleLines(renderer)[0]).toBe('user:@userh:example.org');
      // A word they share leaves the direct chat first.
      await type(renderer, 'User');
      expect(peopleLines(renderer)[0]).toBe('user:@userb:example.org');
    }
    const renderer = renderPalette({ initialTab: 'users', source });
    await type(renderer, 'User C');
    expect(selectedId(renderer)).toBe('user:@userc:example.org');
  });

  it("ranks the server's exact match above people the palette knows who only resemble it", async () => {
    const source: CommandPaletteSource = {
      ...FIXTURE_SOURCE,
      getUsers: vi.fn(() => [
        {
          id: 'user:@userb:example.org',
          kind: 'user' as const,
          displayName: 'User B',
          userId: '@userb:example.org',
          localpart: 'userb',
          existingDmRoomId: '!dm:example.org',
          boost: 10,
          onSelect: vi.fn(),
        },
      ]),
    };
    const renderer = renderPalette({ initialTab: 'users', source });
    setPeople({
      status: 'done',
      items: [
        serverPerson('User Z', {
          id: 'user:@userz:example.org',
          userId: '@userz:example.org',
          localpart: 'userz',
        }),
      ],
    });
    await type(renderer, 'User Z');
    expect(peopleLines(renderer).slice(0, 2)).toEqual([
      'user:@userz:example.org',
      'user:@userb:example.org',
    ]);
    expect(selectedId(renderer)).toBe('user:@userz:example.org');
  });

  it('opens an existing direct chat at once instead of starting another', async () => {
    const requestClose = vi.fn();
    const onSelect = vi.fn();
    const startChat = vi.fn(async () => undefined);
    const source: CommandPaletteSource = {
      ...FIXTURE_SOURCE,
      getUsers: vi.fn(() => [
        {
          id: 'user:@alice:example.org',
          kind: 'user' as const,
          displayName: 'Alice',
          userId: '@alice:example.org',
          localpart: 'alice',
          existingDmRoomId: '!dm:example.org',
          onSelect,
        },
      ]),
    };
    const renderer = renderPalette({ initialTab: 'users', requestClose, source });
    // The directory lists her too, as someone to start a chat with.
    setPeople({ status: 'done', items: [serverPerson('Alice', { startChat })] });
    await type(renderer, 'alice');
    expect(optionIds(renderer)).toEqual(['user:@alice:example.org']);
    await press(renderer, 'Enter');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(startChat).not.toHaveBeenCalled();
    expect(requestClose).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByProps({ 'data-kind': 'start-chat' })).toHaveLength(0);
  });

  it('keeps the question with one quiet line when starting fails, and Enter tries again', async () => {
    const requestClose = vi.fn();
    const quentin = serverPerson('Quentin', {
      startChat: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('M_FORBIDDEN'))
        .mockResolvedValueOnce(undefined),
    });
    const renderer = renderPalette({ initialTab: 'users', requestClose });
    setPeople({ status: 'done', items: [quentin] });
    await type(renderer, 'quentin');
    await press(renderer, 'Enter');
    await press(renderer, 'Enter');
    expect(peopleLines(renderer)).toEqual([
      'start-chat:@quentin:example.org',
      'note:start-chat-error',
    ]);
    expect(renderer.root.findByProps({ 'data-note': 'start-chat-error' }).children).toContain(
      'Could not start the chat. Try again.'
    );
    expect(requestClose).not.toHaveBeenCalled();
    await press(renderer, 'Enter');
    expect(quentin.startChat).toHaveBeenCalledTimes(2);
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('starts one chat even when Enter is pressed again while it starts', async () => {
    const requestClose = vi.fn();
    let finish = () => {};
    const quentin = serverPerson('Quentin', {
      startChat: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      ),
    });
    const renderer = renderPalette({ initialTab: 'users', requestClose });
    setPeople({ status: 'done', items: [quentin] });
    await type(renderer, 'quentin');
    await press(renderer, 'Enter');
    await press(renderer, 'Enter');
    await press(renderer, 'Enter');
    await press(renderer, 'Escape');
    expect(quentin.startChat).toHaveBeenCalledOnce();
    expect(optionIds(renderer)).toEqual(['start-chat:@quentin:example.org']);
    expect(getInput(renderer).props.readOnly).toBe(true);
    expect(peopleSection(renderer).props['aria-busy']).toBe(true);
    await act(async () => finish());
    expect(requestClose).toHaveBeenCalledOnce();
  });
});
