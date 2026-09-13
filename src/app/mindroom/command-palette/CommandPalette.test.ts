import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { CommandPaletteSource } from './commandPaletteItems';
import { CommandPalette } from './CommandPalette';

const { searchCommandPaletteSectionCalls } = vi.hoisted(() => ({
  searchCommandPaletteSectionCalls: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('../../utils/user-agent', () => ({
  isMacOS: () => false,
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
    Line: () => reactModule.createElement('hr'),
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

const getInput = (renderer: ReturnType<typeof create>) => renderer.root.findByType('input');
const getButtons = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => node.type === 'button');
const getContentWrapper = (renderer: ReturnType<typeof create>) =>
  renderer.root.find(
    (node) =>
      node.type === 'div' &&
      node.props.style?.flex === '1 1 auto' &&
      node.props.style?.paddingInline === '16px'
  );

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
  getUsers: vi.fn(() => [
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
  getMessages: (query: string) => {
    if (query.length === 0) return [];

    return [
      {
        id: `message-room-${query}`,
        kind: 'message',
        title: `Search "${query}" in current room`,
        description: 'Fixture message search row',
        scope: 'room',
      },
      {
        id: `message-all-${query}`,
        kind: 'message',
        title: `Search "${query}" across all rooms`,
        description: 'Fixture global search row',
        scope: 'all',
      },
    ];
  },
};

const renderPalette = (props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) =>
  create(
    React.createElement(CommandPalette, {
      requestClose: vi.fn(),
      source: FIXTURE_SOURCE,
      ...props,
    })
  );

describe('CommandPalette', () => {
  it('renders the starter sections for an empty query', () => {
    vi.mocked(FIXTURE_SOURCE.getUsers).mockClear();
    const renderer = renderPalette();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('Open Settings');
    expect(text).toContain('Investigate login incident');
    expect(text).toContain('General');
    expect(text).toContain('Alice');
    expect(text).not.toContain('Search "" in current room');
    expect(FIXTURE_SOURCE.getUsers).toHaveBeenCalledWith({
      exhaustive: false,
      includeRelatedRooms: false,
    });
  });

  it('only requests related-room users for an explicit user search', async () => {
    vi.mocked(FIXTURE_SOURCE.getUsers).mockClear();
    const renderer = renderPalette();

    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: '@alice' } });
    });

    expect(FIXTURE_SOURCE.getUsers).toHaveBeenLastCalledWith({
      exhaustive: true,
      includeRelatedRooms: true,
    });
  });

  it('scopes sections based on the parsed prefix', async () => {
    const renderer = renderPalette();

    await act(async () => {
      getInput(renderer).props.onChange({
        currentTarget: {
          value: '@alice',
        },
      });
    });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Alice');
    expect(text).toContain('@alice:example.org');
    expect(text).not.toContain('Open Settings');
    expect(text).not.toContain('Investigate login incident');
  });

  it('only evaluates the active section after a single-prefix query narrows the mode', async () => {
    const renderer = renderPalette();

    searchCommandPaletteSectionCalls.mockClear();

    await act(async () => {
      getInput(renderer).props.onChange({
        currentTarget: {
          value: '@alice',
        },
      });
    });

    expect(searchCommandPaletteSectionCalls).toHaveBeenCalledTimes(1);
    expect(
      searchCommandPaletteSectionCalls.mock.calls[0]?.[0]?.items.every(
        (item: { kind: string }) => item.kind === 'user'
      )
    ).toBe(true);
  });

  it('keeps the star alias scoped to spaces', async () => {
    const renderer = renderPalette();

    await act(async () => {
      getInput(renderer).props.onChange({
        currentTarget: {
          value: '*',
        },
      });
    });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Engineering Space');
    expect(text).toContain('Nested engineering rooms');
    expect(text).not.toContain('General');
    expect(text).not.toContain('Product');
  });

  it('closes the shell when the selected fixture item is chosen with enter', async () => {
    const requestClose = vi.fn();
    const renderer = renderPalette({ requestClose });

    await act(async () => {
      getInput(renderer).props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });

    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('moves the selected row with arrow keys', async () => {
    const renderer = renderPalette();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getButtons(renderer)[0].props['data-selected']).toBe(true);

    await act(async () => {
      getInput(renderer).props.onKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      });
    });

    const selectedButtons = getButtons(renderer).filter((button) => button.props['data-selected']);

    expect(selectedButtons).toHaveLength(1);
    expect(selectedButtons[0].props['data-item-id']).toBe(
      getButtons(renderer)[1].props['data-item-id']
    );
  });

  it('documents every supported prefix and the open shortcut in the footer', () => {
    const renderer = renderPalette();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('Prefixes:');
    expect(text).toContain('>');
    expect(text).toContain('actions');
    expect(text).toContain('#');
    expect(text).toContain('rooms');
    expect(text).toContain('@');
    expect(text).toContain('users');
    expect(text).toContain('t:');
    expect(text).toContain('threads');
    expect(text).toContain('*');
    expect(text).toContain('spaces');
    expect(text).toContain('Ctrl + K');
  });

  it('keeps the results region as the internal scroll container', () => {
    const renderer = renderPalette();
    const scroll = renderer.root.findByProps({ 'data-testid': 'scroll' });

    expect(scroll.props.style).toEqual({
      flex: '1 1 auto',
      minHeight: 0,
      overflowY: 'auto',
    });
  });

  it('adds a shared inner gutter so content is not flush against the dialog edge', () => {
    const renderer = renderPalette();
    const contentWrapper = getContentWrapper(renderer);

    expect(contentWrapper.props.style).toMatchObject({
      flex: '1 1 auto',
      minHeight: 0,
      paddingInline: '16px',
    });
    expect(contentWrapper.props.style.paddingBottom).toBeUndefined();
  });

  it('keeps the same horizontal gutter on the mobile sheet while preserving safe-area padding', () => {
    const renderer = renderPalette({ mobileSheet: true });
    const contentWrapper = getContentWrapper(renderer);

    expect(contentWrapper.props.style).toMatchObject({
      paddingInline: '16px',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    });
  });
});
