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
  TitleMatch: 'TitleMatch',
  Note: 'Note',
  RowDescription: 'RowDescription',
  RowEnter: 'RowEnter',
  RowEnd: 'RowEnd',
  RowState: 'RowState',
  Key: 'Key',
  Footer: 'Footer',
  KeyboardHints: 'KeyboardHints',
  Hint: 'Hint',
  Empty: 'Empty',
  EmptyTitle: 'EmptyTitle',
  EmptyDescription: 'EmptyDescription',
}));

const reactModule = await vi.hoisted(async () => import('react'));

vi.mock('folds', () => ({
  Icon: ({ src, ...props }: { src: string }) =>
    reactModule.createElement('row-icon', { ...props, src }),
  Spinner: () => null,
  Avatar: ({ children }: { children: React.ReactNode }) => children,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => children,
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    reactModule.createElement('text', props, children),
  Icons: {
    Hash: 'hash',
    Terminal: 'terminal',
    Check: 'check',
    ChevronRight: 'chevron-right',
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

  describe('action rows', () => {
    const renderAction = (item: Record<string, unknown>) =>
      renderList({
        sections: [
          {
            id: 'actions',
            title: 'Actions',
            items: [{ id: 'action:a', kind: 'action', title: 'Dark mode', ...item }],
          },
        ],
      });
    const option = (renderer: ReturnType<typeof renderAction>) =>
      renderer.root.findByProps({ role: 'option' });
    const marked = (renderer: ReturnType<typeof renderAction>, attribute: string) =>
      renderer.root.findAll((node) => typeof node.type === 'string' && attribute in node.props);

    it('shows what a row that flips something is now', () => {
      const on = renderAction({ state: 'on' });
      expect(marked(on, 'data-row-state')[0]?.props['data-row-state']).toBe('on');
      expect(marked(on, 'data-row-state')[0]?.children).toEqual(['On']);
      expect(option(on).props['aria-checked']).toBe(true);
      const off = renderAction({ state: 'off' });
      expect(marked(off, 'data-row-state')[0]?.children).toEqual(['Off']);
      expect(option(off).props['aria-checked']).toBe(false);
    });

    it('marks the choice that is in effect', () => {
      const current = renderAction({ current: true });
      expect(marked(current, 'data-row-current')).toHaveLength(1);
      expect(option(current).props['aria-checked']).toBe(true);
      const other = renderAction({ current: false });
      expect(marked(other, 'data-row-current')).toHaveLength(0);
      expect(option(other).props['aria-checked']).toBe(false);
    });

    it('marks a row that opens a page, with a chevron that turns in right-to-left', () => {
      const page = marked(renderAction({ page: 'theme' }), 'data-row-page');
      expect(page).toHaveLength(1);
      expect(page[0]?.findByType('row-icon' as never).props['data-directional']).toBe(true);
    });

    it('shows the keys of the same action', () => {
      expect(marked(renderAction({ shortcut: 'settings' }), 'data-shortcut-keys')).toHaveLength(1);
    });

    it('shows a tag and its own icon, else the terminal', () => {
      const renderer = renderAction({ tag: 'Settings', icon: 'sun' });
      const heading = renderer.root.findByProps({ className: 'RowHeading' });
      expect(heading.findByProps({ className: 'Tag' }).children).toEqual(['Settings']);
      expect(renderer.root.findByType('row-icon' as never).props.src).toBe('sun');
      expect(renderAction({}).root.findByType('row-icon' as never).props.src).toBe('terminal');
    });

    it('leaves aria-checked and the end off a plain row', () => {
      const plain = renderAction({});
      expect(option(plain).props['aria-checked']).toBeUndefined();
      expect(plain.root.findAllByProps({ className: 'RowEnd' })).toHaveLength(0);
    });

    it('gives a title in another language than the app its language', () => {
      const title = (item: Record<string, unknown>) =>
        renderAction(item).root.findByProps({ className: 'RowTitle' });
      expect(title({ title: 'Nederlands', lang: 'nl' }).props.lang).toBe('nl');
      expect(title({}).props.lang).toBeUndefined();
    });
  });
});

describe('CommandPaletteList marks', () => {
  type Rendered = ReturnType<typeof renderList>;

  /** The marked parts of the row's element with `className`, as text. */
  const marksIn = (renderer: Rendered, className: string): string[] =>
    renderer.root
      .findByProps({ className })
      .findAll((node) => node.type === 'mark' && node.props['data-match'] !== undefined)
      .map((node) => node.children.join(''));

  const textOf = (renderer: Rendered, className: string): string => {
    const read = (node: unknown): string => {
      if (typeof node === 'string') return node;
      if (node && typeof node === 'object' && 'children' in node && Array.isArray(node.children)) {
        return node.children.map(read).join('');
      }
      return '';
    };
    return read(renderer.root.findByProps({ className }));
  };

  const withMarks = (
    item: CommandPaletteListSection['items'][number],
    marks: Record<string, [number, number][]>
  ) =>
    renderList({
      sections: [
        { id: 'rooms', title: 'Rooms', items: [item], marks: new Map([[item.id, marks]]) },
      ],
    });

  it('marks what matched in a room name and leaves the name as it reads', () => {
    const renderer = withMarks(ROOM_SECTION.items[0]!, { name: [[0, 3]] });
    expect(marksIn(renderer, 'RowTitle')).toEqual(['Gen']);
    expect(textOf(renderer, 'RowTitle')).toBe('General');
    expect(marksIn(renderer, 'RowDescription')).toEqual([]);
  });

  it('marks several parts of a title', () => {
    const renderer = withMarks(
      { id: 'create-room', kind: 'action', title: 'Create Room' },
      {
        title: [
          [0, 1],
          [7, 8],
          [10, 11],
        ],
      }
    );
    expect(marksIn(renderer, 'RowTitle')).toEqual(['C', 'R', 'm']);
    expect(textOf(renderer, 'RowTitle')).toBe('Create Room');
  });

  it('marks the line under the title when that is where the text matched', () => {
    const topic = withMarks(ROOM_SECTION.items[0]!, { topic: [[0, 4]] });
    expect(marksIn(topic, 'RowTitle')).toEqual([]);
    expect(marksIn(topic, 'RowDescription')).toEqual(['Team']);

    const person = withMarks(
      {
        id: 'user:@jsmith:example.org',
        kind: 'user',
        displayName: 'John Smith',
        userId: '@jsmith:example.org',
        localpart: 'jsmith',
      },
      { userId: [[1, 7]] }
    );
    expect(marksIn(person, 'RowDescription')).toEqual(['jsmith']);

    const thread = withMarks(
      {
        id: 'thread:1',
        kind: 'thread',
        roomId: '!a:example.org',
        threadId: '$1',
        summaryText: 'Login issue',
        roomName: 'Frontend',
      },
      { roomName: [[0, 5]], summaryText: [[0, 5]] }
    );
    expect(marksIn(thread, 'RowTitle')).toEqual(['Login']);
    expect(marksIn(thread, 'RowDescription')).toEqual(['Front']);
  });

  it('marks the alias only where the row shows it', () => {
    const alias = { canonicalAlias: [[1, 4]] as [number, number][] };
    const shown = withMarks(
      {
        id: '!eng:example.org',
        kind: 'room',
        name: 'Engineering',
        canonicalAlias: '#eng:example.org',
      },
      alias
    );
    expect(marksIn(shown, 'RowDescription')).toEqual(['eng']);
    // With a topic, the row shows that in the alias's place.
    const hidden = withMarks(
      {
        id: '!eng:example.org',
        kind: 'room',
        name: 'Engineering',
        topic: 'Code',
        canonicalAlias: '#eng:example.org',
      },
      alias
    );
    expect(marksIn(hidden, 'RowDescription')).toEqual([]);
  });

  it('marks nothing in a name shown with its direction controls revealed', () => {
    const renderer = withMarks(
      { id: '!odd:example.org', kind: 'room', name: 'Gen\u202eeral' },
      { name: [[0, 3]] }
    );
    expect(marksIn(renderer, 'RowTitle')).toEqual([]);
    expect(textOf(renderer, 'RowTitle')).toBe('Gen<U+202E>eral');
  });

  it('marks nothing in the row of a Matrix ID typed in full', () => {
    const renderer = withMarks(
      {
        id: 'user:@new:example.org',
        kind: 'user',
        displayName: 'new',
        userId: '@new:example.org',
        localpart: 'new',
        typedId: true,
      },
      { displayName: [[0, 3]], userId: [[1, 4]] }
    );
    expect(marksIn(renderer, 'RowTitle')).toEqual([]);
  });

  it('marks nothing without marks', () => {
    const renderer = renderList();
    expect(renderer.root.findAll((node) => node.type === 'mark')).toEqual([]);
  });
});
