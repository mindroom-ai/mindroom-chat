import { describe, expect, it } from 'vitest';
import { getAncestorSpaceIds, isInSpace } from './spaceAncestors';

const tree = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([roomId, parents]) => [roomId, new Set(parents)]));

describe('getAncestorSpaceIds', () => {
  it('lists the parents before the grandparents, each Space once', () => {
    const parents = tree({
      '!room': ['!team', '!project'],
      '!team': ['!company'],
      '!project': ['!company'],
    });
    expect(getAncestorSpaceIds(parents, '!room')).toEqual(['!team', '!project', '!company']);
  });

  it('stops at a loop and never lists the room itself', () => {
    const parents = tree({ '!a': ['!b'], '!b': ['!c'], '!c': ['!a'] });
    expect(getAncestorSpaceIds(parents, '!a')).toEqual(['!b', '!c']);
  });

  it('is empty for a room no Space lists', () => {
    expect(getAncestorSpaceIds(tree({}), '!room')).toEqual([]);
  });
});

describe('isInSpace', () => {
  const parents = tree({ '!room': ['!team'], '!team': ['!company'] });

  it('finds a Space at any depth', () => {
    expect(isInSpace(parents, '!room', '!team')).toBe(true);
    expect(isInSpace(parents, '!room', '!company')).toBe(true);
  });

  it('is false for a Space the room is not under', () => {
    expect(isInSpace(parents, '!team', '!room')).toBe(false);
    expect(isInSpace(parents, '!room', '!other')).toBe(false);
  });
});
