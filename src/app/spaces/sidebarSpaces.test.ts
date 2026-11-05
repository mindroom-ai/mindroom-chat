import { describe, expect, it } from 'vitest';
import { applyLocalOrder, getShownSidebarItems, parseSidebarItems } from './sidebarSpaces';

const joined = (...ids: string[]) => {
  const set = new Set(ids);
  return (roomId: string) => set.has(roomId);
};

describe('parseSidebarItems', () => {
  it('keeps space IDs and folders and drops malformed entries', () => {
    expect(
      parseSidebarItems({
        sidebar: [
          '!a',
          7,
          { id: 'f1', name: 'Work', content: ['!b', 3, '!c'] },
          { name: 'no id', content: ['!d'] },
          null,
        ],
      })
    ).toEqual(['!a', { id: 'f1', name: 'Work', content: ['!b', '!c'] }]);
    expect(parseSidebarItems({ sidebar: 'nope' })).toEqual([]);
    expect(parseSidebarItems(undefined)).toEqual([]);
  });
});

describe('applyLocalOrder', () => {
  it('fills the plain spaces’ places in the device order and leaves folders in place', () => {
    const folder = { id: 'f', content: ['!x'] };
    expect(applyLocalOrder(['!a', folder, '!b', '!c'], ['!c', '!a'])).toEqual([
      '!c',
      folder,
      '!a',
      '!b',
    ]);
  });

  it('ignores IDs the rail does not show', () => {
    expect(applyLocalOrder(['!a', '!b'], ['!gone', '!b'])).toEqual(['!b', '!a']);
  });
});

describe('getShownSidebarItems', () => {
  it('shows saved entries first, then top-level spaces the saved list leaves out', () => {
    expect(
      getShownSidebarItems({
        saved: ['!c', '!a'],
        topLevelSpaces: ['!a', '!b', '!c'],
        isJoinedSpace: joined('!a', '!b', '!c'),
        localOrder: [],
      })
    ).toEqual(['!c', '!a', '!b']);
  });

  it('hides spaces the user left and folders left empty, and keeps pinned subspaces', () => {
    expect(
      getShownSidebarItems({
        saved: ['!left', { id: 'f', content: ['!left-too'] }, '!pinned-sub', '!a'],
        topLevelSpaces: ['!a'],
        isJoinedSpace: joined('!a', '!pinned-sub'),
        localOrder: [],
      })
    ).toEqual(['!pinned-sub', '!a']);
  });

  it('lists a space once even when the saved list repeats it', () => {
    expect(
      getShownSidebarItems({
        saved: ['!a', { id: 'f', content: ['!a', '!b'] }],
        topLevelSpaces: ['!a', '!b'],
        isJoinedSpace: joined('!a', '!b'),
        localOrder: [],
      })
    ).toEqual(['!a', { id: 'f', content: ['!b'] }]);
  });
});
