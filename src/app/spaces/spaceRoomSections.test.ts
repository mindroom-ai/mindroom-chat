import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { RoomToParents, RoomToUnread } from '../matrix/types/room';
import { makeNavCategoryId } from '../ui/nav/closedNavCategories';
import {
  collectShortcutRoomIds,
  getCollapsedSectionUnread,
  getDescendantSubspaces,
  getHomeSpaceSections,
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
  }) as unknown as MatrixClient;

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
        ancestorSpaceIds: [],
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'room'),
        ownRoomsByName: ['!harbor'],
        scopeRoomsByName: ['!harbor'],
      },
      {
        spaceId: '!leaf',
        isRoot: false,
        parentSpaceId: '!org',
        ancestorSpaceIds: ['!org', '!root'],
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'subspace', '!leaf'),
        ownRoomsByName: ['!ops-chat'],
        scopeRoomsByName: ['!ops-chat'],
      },
      {
        spaceId: '!research',
        isRoot: false,
        parentSpaceId: '!root',
        ancestorSpaceIds: ['!root'],
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
        ancestorSpaceIds: [],
        isEmpty: true,
        categoryId: makeNavCategoryId('!root', 'room'),
        ownRoomsByName: [],
        scopeRoomsByName: [],
      },
    ]);
  });

  it('lists a room that is in both a space and its sub-spaces only in the deepest sub-space', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!team': { name: 'Team', space: true },
      '!crew': { name: 'Crew', space: true },
      '!lounge': { name: 'Lounge' },
      '!garden': { name: 'Garden' },
      '!garden-notes': { name: 'Garden Notes' },
      '!workshop': { name: 'Workshop' },
    });
    const joined = ['!root', '!team', '!crew', '!lounge', '!garden', '!garden-notes', '!workshop'];
    const parents = makeParents({
      '!team': ['!root'],
      '!crew': ['!team'],
      '!lounge': ['!root'],
      '!garden': ['!root', '!team'],
      '!garden-notes': ['!garden'],
      '!workshop': ['!root', '!team', '!crew'],
    });

    const sections = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      ['!garden', '!garden-notes', '!lounge', '!workshop'],
      new Set(),
      parents,
      new Set(['!garden'])
    );

    expect(
      sections.map(({ spaceId, ownRoomsByName, scopeRoomsByName }) => [
        spaceId,
        ownRoomsByName,
        scopeRoomsByName,
      ])
    ).toEqual([
      ['!root', ['!lounge'], ['!lounge']],
      ['!team', ['!garden'], ['!garden', '!garden-notes']],
      ['!crew', ['!workshop'], ['!workshop']],
    ]);
  });

  it('hides the root Rooms section when every one of its rooms is also in a sub-space', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!team': { name: 'Team', space: true },
      '!garden': { name: 'Garden' },
    });
    const joined = ['!root', '!team', '!garden'];
    const parents = makeParents({ '!team': ['!root'], '!garden': ['!root', '!team'] });

    const sections = getSpaceRoomSections(
      mx,
      '!root',
      joined,
      joined,
      ['!garden'],
      new Set(),
      parents,
      new Set()
    );

    expect(sections.map((section) => section.spaceId)).toEqual(['!team']);
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
        ancestorSpaceIds: [],
        isEmpty: false,
        categoryId: makeNavCategoryId('!root', 'room'),
        ownRoomsByName: [],
        scopeRoomsByName: ['!orphan'],
      },
      {
        spaceId: '!sub',
        isRoot: false,
        parentSpaceId: '!root',
        ancestorSpaceIds: ['!root'],
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
        section.ancestorSpaceIds,
        section.isEmpty,
      ])
    ).toEqual([
      ['!root', true, undefined, [], true],
      ['!editable-empty', false, '!root', ['!root'], true],
      ['!leaf', false, '!readonly-org', ['!readonly-org', '!root'], false],
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

describe('getHomeSpaceSections', () => {
  const expectEveryRoomCovered = (
    homeRooms: string[],
    result: ReturnType<typeof getHomeSpaceSections>
  ) => {
    const inSections = new Set(result.sections.flatMap((section) => section.scopeRoomsByName));
    const unspaced = new Set(result.unspacedByName);
    homeRooms.forEach((roomId) => {
      expect(unspaced.has(roomId) || inSections.has(roomId)).toBe(true);
      expect(unspaced.has(roomId) && inSections.has(roomId)).toBe(false);
    });
  };

  it('orders rail spaces with DFS sub-spaces right after their parent and keeps unspaced rooms separate', () => {
    const mx = makeClient({
      '!notes': { name: 'Personal Notes' },
      '!work': { name: 'Work', space: true },
      '!planning': { name: 'Weekly Planning' },
      '!design': { name: 'Design Team', space: true },
      '!sketches': { name: 'Sketches' },
      '!garden': { name: 'Garden Club', space: true },
      '!plants': { name: 'Plant Care' },
      '!shared': { name: 'Cross-Team' },
    });
    const joined = [
      '!notes',
      '!work',
      '!planning',
      '!design',
      '!sketches',
      '!garden',
      '!plants',
      '!shared',
    ];
    const homeRooms = ['!shared', '!notes', '!plants', '!sketches', '!planning'];
    const parents = makeParents({
      '!design': ['!work'],
      '!planning': ['!work'],
      '!sketches': ['!design'],
      '!plants': ['!garden'],
      // Room shared across two unrelated spaces shows in both.
      '!shared': ['!work', '!garden'],
    });

    // Rail order flattened across folders puts Garden Club before Work.
    const result = getHomeSpaceSections(
      mx,
      ['!garden', '!work'],
      joined,
      joined,
      homeRooms,
      new Set(),
      parents,
      new Set()
    );

    expect(result.unspacedByName).toEqual(['!notes']);
    expect(
      result.sections.map((section) => ({
        spaceId: section.spaceId,
        isRoot: section.isRoot,
        parentSpaceId: section.parentSpaceId,
        ancestorSpaceIds: section.ancestorSpaceIds,
        categoryId: section.categoryId,
        scopeRoomsByName: section.scopeRoomsByName,
      }))
    ).toEqual([
      {
        spaceId: '!garden',
        isRoot: false,
        parentSpaceId: undefined,
        ancestorSpaceIds: [],
        categoryId: makeNavCategoryId('home', 'space', '!garden'),
        scopeRoomsByName: ['!shared', '!plants'],
      },
      {
        spaceId: '!work',
        isRoot: false,
        parentSpaceId: undefined,
        ancestorSpaceIds: [],
        categoryId: makeNavCategoryId('home', 'space', '!work'),
        scopeRoomsByName: ['!shared', '!planning'],
      },
      {
        spaceId: '!design',
        isRoot: false,
        parentSpaceId: '!work',
        ancestorSpaceIds: ['!work'],
        categoryId: makeNavCategoryId('home', 'space', '!design'),
        scopeRoomsByName: ['!sketches'],
      },
    ]);
    expectEveryRoomCovered(homeRooms, result);
  });

  it('dedupes rooms across full Matrix descendants even when a sub-space is pinned above its parent or shared in a diamond', () => {
    const mx = makeClient({
      '!root': { name: 'Root', space: true },
      '!alpha': { name: 'Alpha', space: true },
      '!beta': { name: 'Beta', space: true },
      '!leaf': { name: 'Leaf', space: true },
      '!shared-room': { name: 'Shared Room' },
      '!root-only': { name: 'Root Only' },
    });
    const joined = ['!root', '!alpha', '!beta', '!leaf', '!shared-room', '!root-only'];
    const homeRooms = ['!root-only', '!shared-room'];
    const parents = makeParents({
      '!alpha': ['!root'],
      '!beta': ['!root'],
      '!leaf': ['!alpha', '!beta'],
      // Listed in Root, Beta, AND Leaf — must appear in Leaf only, even though Leaf is pinned first.
      '!shared-room': ['!root', '!beta', '!leaf'],
      '!root-only': ['!root'],
    });

    const result = getHomeSpaceSections(
      mx,
      ['!leaf', '!root'],
      joined,
      joined,
      homeRooms,
      new Set(),
      parents,
      new Set()
    );

    expect(result.unspacedByName).toEqual([]);
    expect(
      result.sections.map((section) => ({
        spaceId: section.spaceId,
        parentSpaceId: section.parentSpaceId,
        ancestorSpaceIds: section.ancestorSpaceIds,
        scopeRoomsByName: section.scopeRoomsByName,
      }))
    ).toEqual([
      {
        spaceId: '!leaf',
        parentSpaceId: '!alpha',
        ancestorSpaceIds: ['!alpha', '!root'],
        scopeRoomsByName: ['!shared-room'],
      },
      {
        spaceId: '!root',
        parentSpaceId: undefined,
        ancestorSpaceIds: [],
        scopeRoomsByName: ['!root-only'],
      },
    ]);
    expectEveryRoomCovered(homeRooms, result);
  });

  it('sweeps mutual space cycles and sub-spaces whose parent was left, and falls back to unspaced when a room’s space is left', () => {
    const mx = makeClient({
      '!cycle-a': { name: 'Cycle A', space: true },
      '!cycle-b': { name: 'Cycle B', space: true },
      '!cycle-room': { name: 'Cycle Room' },
      '!left-parent': { name: 'Left Parent', space: true },
      '!orphan-space': { name: 'Orphan Space', space: true },
      '!orphan-space-room': { name: 'Orphan Space Room' },
      '!left-only-space': { name: 'Left Only', space: true },
      '!fell-back': { name: 'Fell Back' },
    });
    // !left-parent and !left-only-space are NOT in joinedRoomIds.
    const joined = [
      '!cycle-a',
      '!cycle-b',
      '!cycle-room',
      '!orphan-space',
      '!orphan-space-room',
      '!fell-back',
    ];
    const homeRooms = ['!cycle-room', '!fell-back', '!orphan-space-room'];
    const parents = makeParents({
      '!cycle-a': ['!cycle-b'],
      '!cycle-b': ['!cycle-a'],
      '!cycle-room': ['!cycle-a', '!cycle-b'],
      '!orphan-space': ['!left-parent'],
      '!orphan-space-room': ['!orphan-space'],
      '!fell-back': ['!left-only-space'],
    });

    const result = getHomeSpaceSections(
      mx,
      [],
      joined,
      joined,
      homeRooms,
      new Set(),
      parents,
      new Set()
    );

    expect(result.unspacedByName).toEqual(['!fell-back']);
    expect(
      result.sections.map((section) => [
        section.spaceId,
        section.parentSpaceId,
        section.scopeRoomsByName,
      ])
    ).toEqual([
      ['!orphan-space', undefined, ['!orphan-space-room']],
      ['!cycle-b', '!cycle-a', ['!cycle-room']],
    ]);
    expectEveryRoomCovered(homeRooms, result);
  });

  it('keeps editable empty spaces, hides read-only empty organizers while keeping populated descendants and orphaned sub-rooms', () => {
    const mx = makeClient({
      '!org': { name: 'Empty Organizer', space: true },
      '!editable-empty': { name: 'Editable Empty', space: true },
      '!readonly-empty': { name: 'Readonly Empty', space: true },
      '!leaf': { name: 'Leaf', space: true },
      '!archived-parent': { name: 'Archived Parent' },
      '!orphan-sub': { name: 'Orphan Sub' },
    });
    const joined = [
      '!org',
      '!editable-empty',
      '!readonly-empty',
      '!leaf',
      '!archived-parent',
      '!orphan-sub',
    ];
    // !archived-parent is archived (not visible), !orphan-sub is its visible chat sub-room.
    const visible = ['!org', '!editable-empty', '!readonly-empty', '!leaf', '!orphan-sub'];
    const homeRooms = ['!orphan-sub'];
    const parents = makeParents({
      '!leaf': ['!org'],
      '!archived-parent': ['!leaf'],
      '!orphan-sub': ['!archived-parent'],
    });

    const result = getHomeSpaceSections(
      mx,
      ['!org', '!editable-empty', '!readonly-empty'],
      joined,
      visible,
      homeRooms,
      new Set(),
      parents,
      new Set(['!archived-parent']),
      (spaceId) => spaceId === '!editable-empty'
    );

    expect(result.unspacedByName).toEqual([]);
    expect(
      result.sections.map((section) => ({
        spaceId: section.spaceId,
        isEmpty: section.isEmpty,
        parentSpaceId: section.parentSpaceId,
        ancestorSpaceIds: section.ancestorSpaceIds,
        ownRoomsByName: section.ownRoomsByName,
        scopeRoomsByName: section.scopeRoomsByName,
      }))
    ).toEqual([
      {
        spaceId: '!leaf',
        isEmpty: false,
        parentSpaceId: '!org',
        ancestorSpaceIds: ['!org'],
        ownRoomsByName: [],
        scopeRoomsByName: ['!orphan-sub'],
      },
      {
        spaceId: '!editable-empty',
        isEmpty: true,
        parentSpaceId: undefined,
        ancestorSpaceIds: [],
        ownRoomsByName: [],
        scopeRoomsByName: [],
      },
    ]);
    expectEveryRoomCovered(homeRooms, result);
  });

  it('tracks only the single displayed parent chain for a diamond-shared sub-space and its descendants', () => {
    const mx = makeClient({
      '!work': { name: 'Work', space: true },
      '!garden': { name: 'Garden', space: true },
      '!design': { name: 'Design Team', space: true },
      '!sketches': { name: 'Sketches', space: true },
      '!wireframes': { name: 'Wireframes' },
      '!mocks': { name: 'Mocks' },
      '!planning': { name: 'Weekly Planning' },
      '!plants': { name: 'Plant Care' },
    });
    const joined = [
      '!work',
      '!garden',
      '!design',
      '!sketches',
      '!wireframes',
      '!mocks',
      '!planning',
      '!plants',
    ];
    const homeRooms = ['!mocks', '!plants', '!planning', '!wireframes'];
    const parents = makeParents({
      '!design': ['!work', '!garden'],
      '!sketches': ['!design'],
      '!wireframes': ['!sketches'],
      '!mocks': ['!design'],
      '!planning': ['!work'],
      '!plants': ['!garden'],
    });

    const result = getHomeSpaceSections(
      mx,
      ['!work', '!garden'],
      joined,
      joined,
      homeRooms,
      new Set(),
      parents,
      new Set()
    );

    const design = result.sections.find((section) => section.spaceId === '!design')!;
    const sketches = result.sections.find((section) => section.spaceId === '!sketches')!;
    expect(design.parentSpaceId).toBe('!work');
    expect(design.ancestorSpaceIds).toEqual(['!work']);
    expect(sketches.parentSpaceId).toBe('!design');
    expect(sketches.ancestorSpaceIds).toEqual(['!design', '!work']);
    expectEveryRoomCovered(homeRooms, result);
  });
});
