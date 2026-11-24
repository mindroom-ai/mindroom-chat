import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { RoomToParents, RoomToUnread } from '../../matrix/types/room';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import {
  collectShortcutRoomIds,
  getCollapsedSectionUnread,
  getDescendantSubspaces,
  getSpaceRoomSections,
} from './spaceRoomSections';

const SPACE_CREATE = { getContent: () => ({ type: 'm.space' }) };

const makeClient = (entries: Record<string, { name: string; space?: boolean }>): MatrixClient =>
  ({
    getRoom: (roomId: string) => {
      const entry = entries[roomId];
      if (!entry) return null;
      return {
        roomId,
        name: entry.name,
        getLiveTimeline: () => ({
          getState: () => ({
            getStateEvents: () => (entry.space ? SPACE_CREATE : undefined),
          }),
        }),
      };
    },
  } as unknown as MatrixClient);

const makeParents = (entries: Record<string, string[]>): RoomToParents =>
  new Map(Object.entries(entries).map(([roomId, parents]) => [roomId, new Set(parents)]));

describe('getDescendantSubspaces', () => {
  it('walks joined sub-spaces in pre-order DFS sorted A to Z at each level', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!beta': { name: 'Beta', space: true },
      '!alpha': { name: 'Alpha', space: true },
      '!zeta': { name: 'Zeta', space: true },
      '!delta': { name: 'Delta', space: true },
      '!unjoined': { name: 'Aardvark', space: true },
    });
    const joined = ['!root', '!beta', '!alpha', '!zeta', '!delta'];
    const parents = makeParents({
      '!beta': ['!root'],
      '!alpha': ['!root'],
      '!unjoined': ['!root'],
      '!zeta': ['!alpha'],
      '!delta': ['!alpha'],
    });

    expect(getDescendantSubspaces(mx, '!root', joined, parents)).toEqual([
      '!alpha',
      '!delta',
      '!zeta',
      '!beta',
    ]);
  });

  it('terminates on cycles and deduplicates diamond-shared sub-spaces at first occurrence', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!alpha': { name: 'Alpha', space: true },
      '!beta': { name: 'Beta', space: true },
      '!shared': { name: 'Shared', space: true },
    });
    const joined = ['!root', '!alpha', '!beta', '!shared'];
    const parents = makeParents({
      '!root': ['!root', '!alpha'],
      '!alpha': ['!root', '!beta'],
      '!beta': ['!root', '!alpha'],
      '!shared': ['!alpha', '!beta'],
    });

    expect(getDescendantSubspaces(mx, '!root', joined, parents)).toEqual([
      '!alpha',
      '!beta',
      '!shared',
    ]);
  });
});

describe('getSpaceRoomSections', () => {
  it('orders root Rooms first, hides empty intermediate organizers, and keeps their populated descendants', () => {
    const mx = makeClient({
      '!root': { name: 'Field Notes', space: true },
      '!org': { name: 'Division', space: true },
      '!leaf': { name: 'Field Ops', space: true },
      '!research': { name: 'Research Group', space: true },
      '!harbor': { name: 'Harbor Plans' },
      '!ops-chat': { name: 'Ops Chat' },
      '!reading': { name: 'Reading List' },
      '!dm': { name: 'Direct' },
    });
    const joined = [
      '!root',
      '!org',
      '!leaf',
      '!research',
      '!harbor',
      '!ops-chat',
      '!reading',
      '!dm',
    ];
    const parents = makeParents({
      '!org': ['!root'],
      '!leaf': ['!org'],
      '!research': ['!root'],
      '!harbor': ['!root'],
      '!ops-chat': ['!leaf'],
      '!reading': ['!research'],
      '!dm': ['!org'],
    });
    const sections = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      ['!harbor', '!ops-chat', '!reading'],
      new Set(['!dm']),
      parents,
      new Set()
    );

    expect(sections).toEqual([
      {
        spaceId: '!root',
        isRoot: true,
        parentSpaceId: undefined,
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'room'),
        ownRoomsByName: ['!harbor'],
        scopeRoomsByName: ['!harbor'],
      },
      {
        spaceId: '!leaf',
        isRoot: false,
        parentSpaceId: '!org',
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'subspace', '!leaf'),
        ownRoomsByName: ['!ops-chat'],
        scopeRoomsByName: ['!ops-chat'],
      },
      {
        spaceId: '!research',
        isRoot: false,
        parentSpaceId: '!root',
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'subspace', '!research'),
        ownRoomsByName: ['!reading'],
        scopeRoomsByName: ['!reading'],
      },
    ]);
  });

  it('hides the empty root Rooms section when at least one sub-space section is shown', () => {
    const mx = makeClient({
      '!root': { name: 'Organizer', space: true },
      '!design': { name: 'Design Team', space: true },
      '!review': { name: 'Design Review' },
    });
    const joined = ['!root', '!design', '!review'];
    const parents = makeParents({
      '!design': ['!root'],
      '!review': ['!design'],
    });

    const sections = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      ['!review'],
      new Set(),
      parents,
      new Set()
    );

    expect(sections.map((section) => [section.spaceId, section.isRoot])).toEqual([
      ['!design', false],
    ]);
  });

  it('keeps the root Rooms section when the entire space and all sub-spaces are empty', () => {
    const mx = makeClient({
      '!root': { name: 'Empty Space', space: true },
      '!empty-sub': { name: 'Empty Sub', space: true },
    });
    const joined = ['!root', '!empty-sub'];
    const parents = makeParents({ '!empty-sub': ['!root'] });

    const sections = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      [],
      new Set(),
      parents,
      new Set()
    );

    expect(sections).toEqual([
      {
        spaceId: '!root',
        isRoot: true,
        parentSpaceId: undefined,
        isEmpty: true,
        categoryId: makeNavCategoryId('!root', 'room'),
        ownRoomsByName: [],
        scopeRoomsByName: [],
      },
    ]);
  });

  it('scopes chat-room sub-rooms and archived-parent orphans to their own section', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!sub': { name: 'Sub', space: true },
      '!archived': { name: 'Archived' },
      '!orphan': { name: 'Orphan Sub-Room' },
      '!sub-room': { name: 'Sub Room' },
      '!sub-child': { name: 'Sub Child' },
    });
    const joined = ['!root', '!sub', '!archived', '!orphan', '!sub-room', '!sub-child'];
    const visible = ['!root', '!sub', '!orphan', '!sub-room', '!sub-child'];
    const parents = makeParents({
      '!sub': ['!root'],
      '!archived': ['!root'],
      '!orphan': ['!archived'],
      '!sub-room': ['!sub'],
      '!sub-child': ['!sub-room'],
    });

    const sections = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      visible,
      ['!orphan', '!sub-child', '!sub-room'],
      new Set(),
      parents,
      new Set(['!archived', '!sub-room'])
    );

    expect(sections).toEqual([
      {
        spaceId: '!root',
        isRoot: true,
        parentSpaceId: undefined,
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'room'),
        ownRoomsByName: [],
        scopeRoomsByName: ['!orphan'],
      },
      {
        spaceId: '!sub',
        isRoot: false,
        parentSpaceId: '!root',
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'subspace', '!sub'),
        ownRoomsByName: ['!sub-room'],
        scopeRoomsByName: ['!sub-child', '!sub-room'],
      },
    ]);
  });

  it('keeps editable empty sub-spaces and empty editable root Rooms while hiding non-editable empty organizers', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!editable-empty': { name: 'Editable Empty', space: true },
      '!readonly-org': { name: 'Readonly Organizer', space: true },
      '!leaf': { name: 'Leaf', space: true },
      '!leaf-room': { name: 'Leaf Room' },
    });
    const joined = ['!root', '!editable-empty', '!readonly-org', '!leaf', '!leaf-room'];
    const parents = makeParents({
      '!editable-empty': ['!root'],
      '!readonly-org': ['!root'],
      '!leaf': ['!readonly-org'],
      '!leaf-room': ['!leaf'],
    });

    // When root and editable-empty are editable, both appear even while empty,
    // while readonly-org stays hidden without hiding its populated descendant !leaf.
    const editable = new Set(['!root', '!editable-empty']);
    const sectionsWithEditableRoot = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      ['!leaf-room'],
      new Set(),
      parents,
      new Set(),
      (spaceId) => editable.has(spaceId)
    );
    expect(
      sectionsWithEditableRoot.map((section) => [
        section.spaceId,
        section.isRoot,
        section.parentSpaceId,
        section.isEmpty,
      ])
    ).toEqual([
      ['!root', true, undefined, true],
      ['!editable-empty', false, '!root', true],
      ['!leaf', false, '!readonly-org', false],
    ]);

    // When root is NOT editable, the empty root Rooms section is hidden again,
    // while editable-empty and populated !leaf remain visible.
    const sectionsReadonlyRoot = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      ['!leaf-room'],
      new Set(),
      parents,
      new Set(),
      (spaceId) => spaceId === '!editable-empty'
    );
    expect(sectionsReadonlyRoot.map((section) => [section.spaceId, section.isRoot])).toEqual([
      ['!editable-empty', false],
      ['!leaf', false],
    ]);
  });
});

describe('getCollapsedSectionUnread', () => {
  const unreads: RoomToUnread = new Map([
    ['!quiet', { total: 0, highlight: 0 }],
    ['!mention', { total: 2, highlight: 1 }],
  ]);

  it('returns undefined while expanded', () => {
    expect(getCollapsedSectionUnread(false, ['!quiet', '!mention'], undefined, unreads)).toBe(
      undefined
    );
  });

  it('reports unread and highlight for hidden rooms and skips the lone visible selected room', () => {
    expect(getCollapsedSectionUnread(true, ['!quiet', '!read'], undefined, unreads)).toEqual({
      highlight: false,
    });
    expect(getCollapsedSectionUnread(true, ['!quiet', '!read'], '!quiet', unreads)).toBeUndefined();
    expect(getCollapsedSectionUnread(true, ['!quiet', '!mention'], '!quiet', unreads)).toEqual({
      highlight: true,
    });
    expect(getCollapsedSectionUnread(true, ['!quiet', '!mention'], '!mention', unreads)).toEqual({
      highlight: false,
    });
    expect(getCollapsedSectionUnread(true, ['!quiet'], undefined, unreads)).toBe(
      getCollapsedSectionUnread(true, ['!quiet', '!read'], undefined, unreads)
    );
    expect(getCollapsedSectionUnread(true, ['!mention'], undefined, unreads)).toBe(
      getCollapsedSectionUnread(true, ['!quiet', '!mention'], undefined, unreads)
    );
  });
});

describe('collectShortcutRoomIds', () => {
  it('collects visible rooms across sections in rendered order, deduplicated', () => {
    expect(
      collectShortcutRoomIds([
        { closed: false, listedRoomIds: ['!a'], shownRoomIds: ['!a', '!a-sub'] },
        { closed: true, listedRoomIds: [], shownRoomIds: ['!hidden'] },
        { closed: true, listedRoomIds: ['!selected'], shownRoomIds: ['!selected', '!other'] },
        { closed: false, listedRoomIds: ['!a', '!b'], shownRoomIds: ['!a', '!b'] },
      ])
    ).toEqual(['!a', '!a-sub', '!selected', '!b']);
  });
});
