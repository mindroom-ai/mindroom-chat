import { describe, expect, it } from 'vitest';
import {
  type HierarchySources,
  type SpaceChildLink,
  buildHierarchyItems,
  sortSpaceChildren,
} from './useSpaceHierarchy';

const link = (roomId: string, ts: number, extra: Partial<SpaceChildLink['content']> = {}) => ({
  roomId,
  ts,
  content: { via: ['example.org'], ...extra },
});

const tree = (
  children: Record<string, SpaceChildLink[]>,
  spaces: string[] = Object.keys(children)
): HierarchySources => ({
  childrenOf: (spaceId) => children[spaceId],
  isSpace: (roomId) => spaces.includes(roomId),
});

describe('sortSpaceChildren', () => {
  it('puts ordered children first, by order, then the rest by age and room ID', () => {
    const sorted = sortSpaceChildren([
      link('!late', 30),
      link('!b-order', 50, { order: 'b' }),
      link('!early', 10),
      link('!a-order', 90, { order: 'a' }),
      link('!tie-z', 20),
      link('!tie-a', 20),
    ]);
    expect(sorted.map((child) => child.roomId)).toEqual([
      '!a-order',
      '!b-order',
      '!early',
      '!tie-a',
      '!tie-z',
      '!late',
    ]);
  });

  it('ignores an order that is too long or not printable ASCII', () => {
    const sorted = sortSpaceChildren([
      link('!plain', 1),
      link('!long', 2, { order: 'x'.repeat(51) }),
      link('!tab', 3, { order: 'a\tb' }),
      link('!valid', 4, { order: '~' }),
    ]);
    expect(sorted.map((child) => child.roomId)).toEqual(['!valid', '!plain', '!long', '!tab']);
  });
});

describe('buildHierarchyItems', () => {
  it('lists each space’s rooms before its subspaces, and subspaces with their own rooms', () => {
    const items = buildHierarchyItems(
      '!root',
      tree({
        '!root': [link('!sub', 1), link('!room-1', 2), link('!room-2', 3)],
        '!sub': [link('!sub-room', 1)],
      })
    );
    expect(
      items.map(({ roomId, depth, parentId, space }) => [roomId, depth, parentId, !!space])
    ).toEqual([
      ['!room-1', 1, '!root', false],
      ['!room-2', 1, '!root', false],
      ['!sub', 1, '!root', true],
      ['!sub-room', 2, '!sub', false],
    ]);
  });

  it('skips links without servers to join through', () => {
    const items = buildHierarchyItems(
      '!root',
      tree({ '!root': [link('!kept', 1), { roomId: '!removed', ts: 2, content: {} }] })
    );
    expect(items.map((item) => item.roomId)).toEqual(['!kept']);
  });

  it('expands a space only once when the tree loops back', () => {
    const items = buildHierarchyItems(
      '!root',
      tree({
        '!root': [link('!a', 1)],
        '!a': [link('!b', 1)],
        '!b': [link('!a', 1), link('!root', 2)],
      })
    );
    expect(items.map((item) => `${item.parentId}>${item.roomId}`)).toEqual([
      '!root>!a',
      '!a>!b',
      '!b>!a',
      '!b>!root',
    ]);
  });

  it('shows an unknown subspace as a heading without children', () => {
    const items = buildHierarchyItems(
      '!root',
      tree({ '!root': [link('!far-space', 1)] }, ['!root', '!far-space'])
    );
    expect(items).toEqual([
      expect.objectContaining({ roomId: '!far-space', space: true, depth: 1, parentId: '!root' }),
    ]);
  });
});
