import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteList, type CommandPaletteListSection } from './CommandPaletteList';

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

vi.mock('folds', () => ({
  Icon: () => null,
  Spinner: () => null,
  Avatar: ({ children }: { children: React.ReactNode }) => children,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => children,
  Text: ({ children }: { children: React.ReactNode }) => children,
  Icons: {
    Hash: 'hash',
    Terminal: 'terminal',
    Space: 'space',
    Message: 'message',
    Search: 'search',
    User: 'user',
  },
}));

vi.mock('../i18n/useRelativeTime', () => ({
  useRelativeTime: (ts: number, format: string) => `${format}:${ts}`,
}));

vi.mock('../ui/UnreadBadge', async () => {
  const reactModule = await import('react');
  return {
    UnreadBadge: (props: { highlight: boolean; count: number; selected?: boolean }) =>
      reactModule.createElement('unread-badge', props),
  };
});

const ROOM_SECTION: CommandPaletteListSection = {
  id: 'rooms',
  title: 'Rooms',
  items: [{ id: '!general:example.org', kind: 'room', name: 'General', topic: 'Team chat' }],
};
const renderList = (props: Partial<React.ComponentProps<typeof CommandPaletteList>> = {}) =>
  create(
    React.createElement(CommandPaletteList, {
      id: 'results',
      label: 'Search results',
      sections: [ROOM_SECTION],
      onSelect: vi.fn(),
      onHighlight: vi.fn(),
      ...props,
    })
  );

describe('CommandPaletteList', () => {
  it('gives each result group a visible accessible category label', () => {
    const renderer = renderList();
    const group = renderer.root.findByProps({ role: 'group' });
    const label = renderer.root.findByProps({ id: group.props['aria-labelledby'] });
    expect(label.children).toContain('Rooms');
    expect(JSON.stringify(renderer.toJSON())).toContain('Team chat');
  });

  it('exposes selection without putting every result in the Tab order', () => {
    const renderer = renderList({ selectedItemId: '!general:example.org' });
    const row = renderer.root.findByProps({ role: 'option' });
    expect(row.props['aria-selected']).toBe(true);
    expect(row.props.tabIndex).toBe(-1);
  });

  it('opens the clicked result', () => {
    const onSelect = vi.fn();
    const renderer = renderList({ onSelect });
    renderer.root.findByProps({ role: 'option' }).props.onClick();
    expect(onSelect).toHaveBeenCalledWith(ROOM_SECTION.items[0]);
  });

  it('shows unread counts on rooms so busy rooms stand out', () => {
    const renderer = renderList({
      selectedItemId: '!ops:example.org',
      sections: [
        {
          id: 'rooms',
          title: 'Rooms',
          items: [
            ROOM_SECTION.items[0]!,
            {
              id: '!ops:example.org',
              kind: 'room',
              name: 'Ops',
              unreadCount: 4,
              unreadHighlight: true,
            },
            { id: '!quiet:example.org', kind: 'room', name: 'Quiet', unreadCount: 0 },
          ],
        },
      ],
    });
    // Like the room list: a count, or a dot for unread messages without notifications.
    const badges = renderer.root.findAllByType('unread-badge' as never);
    expect(badges.map((badge) => badge.props)).toEqual([
      { count: 4, highlight: true },
      { count: 0, highlight: false },
    ]);
  });

  it('does not change keyboard selection when a touch pointer scrolls the list', () => {
    const onHighlight = vi.fn();
    const renderer = renderList({ onHighlight });
    renderer.root.findByProps({ role: 'option' }).props.onPointerMove({ pointerType: 'touch' });
    expect(onHighlight).not.toHaveBeenCalled();
  });

  it('marks spaces among the rooms', () => {
    const renderer = renderList({
      sections: [
        {
          id: 'rooms',
          title: 'Rooms',
          items: [
            ROOM_SECTION.items[0]!,
            { id: '!garden:example.org', kind: 'space', name: 'Garden' },
          ],
        },
      ],
    });
    const tags = renderer.root.findAllByProps({ className: 'Tag' });
    expect(tags).toHaveLength(1);
    expect(tags[0]?.children).toEqual(['Space']);
    const space = renderer.root.findByProps({ 'data-kind': 'space' });
    expect(space.findByProps({ className: 'Tag' })).toBe(tags[0]);
  });

  it('shows a message hit with its sender, room, thread, marked match and time', () => {
    const renderer = renderList({
      sections: [
        {
          id: 'messages',
          title: 'Messages',
          notes: [{ id: 'encrypted', text: "The server can't search encrypted rooms." }],
          items: [
            {
              id: 'message:!ops:example.org:$hit',
              kind: 'message',
              senderName: 'Alice',
              roomName: 'Ops',
              threadName: 'Deploy plan',
              snippet: 'the walrus rollout starts at noon',
              highlights: ['walrus'],
              timestamp: 1_700_000_000_000,
            },
            { id: 'search-page', kind: 'search-page', term: 'walrus' },
          ],
        },
      ],
    });
    const hit = renderer.root.findByProps({ 'data-kind': 'message' });
    expect(hit.findByProps({ className: 'RowTitle' }).children).toEqual(['Alice']);
    // Each name in its own isolate, so an Arabic room and thread keep the room first.
    const place = hit.findByProps({ className: 'RowPlace' });
    expect(place.findAllByType('bdi').map((name) => name.children)).toEqual([
      ['Ops'],
      ['Deploy plan'],
    ]);
    expect(place.props.dir).toBeUndefined();
    expect(hit.findByType('mark').children).toEqual(['walrus']);
    expect(hit.findByType('time').children).toEqual(['compact:1700000000000']);
    // The note sits under the title; the count leaves out See all results.
    expect(renderer.root.findByProps({ 'data-note': 'encrypted' }).children).toContain(
      "The server can't search encrypted rooms."
    );
    expect(renderer.root.findByProps({ className: 'GroupCount' }).children).toEqual(['1']);
    const seeAll = renderer.root.findByProps({ 'data-kind': 'search-page' });
    expect(seeAll.findByProps({ className: 'RowTitle' }).children).toEqual(['See all results']);
  });

  it('names an untitled thread of a message hit', () => {
    const renderer = renderList({
      sections: [
        {
          id: 'messages',
          title: 'Messages',
          items: [
            {
              id: 'message:!ops:example.org:$reply',
              kind: 'message',
              senderName: 'Bob',
              roomName: 'Ops',
              threadName: '',
              snippet: 'no match marked here',
              highlights: [],
              timestamp: Date.now(),
            },
          ],
        },
      ],
    });
    const place = renderer.root.findByProps({ className: 'RowPlace' });
    expect(place.findAllByType('bdi').map((name) => name.children)).toEqual([['Ops'], ['Thread']]);
    expect(renderer.root.findAllByType('mark')).toHaveLength(0);
  });
});
