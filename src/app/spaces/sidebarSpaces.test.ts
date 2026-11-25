import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getShownSidebarItems, parseSidebarItems, sortSpacesByAge } from './sidebarSpaces';

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

describe('getShownSidebarItems', () => {
  it('shows saved entries first, then top-level spaces the saved list leaves out', () => {
    expect(
      getShownSidebarItems({
        saved: ['!c', '!a'],
        topLevelSpaces: ['!a', '!b', '!c'],
        isJoinedSpace: joined('!a', '!b', '!c'),
      })
    ).toEqual(['!c', '!a', '!b']);
  });

  it('hides spaces the user left and folders left empty, and keeps pinned subspaces', () => {
    expect(
      getShownSidebarItems({
        saved: ['!left', { id: 'f', content: ['!left-too'] }, '!pinned-sub', '!a'],
        topLevelSpaces: ['!a'],
        isJoinedSpace: joined('!a', '!pinned-sub'),
      })
    ).toEqual(['!pinned-sub', '!a']);
  });

  it('lists a space once even when the saved list repeats it', () => {
    expect(
      getShownSidebarItems({
        saved: ['!a', { id: 'f', content: ['!a', '!b'] }],
        topLevelSpaces: ['!a', '!b'],
        isJoinedSpace: joined('!a', '!b'),
      })
    ).toEqual(['!a', { id: 'f', content: ['!b'] }]);
  });
});

describe('sortSpacesByAge', () => {
  /** A client whose rooms were made at the given times; a room without a time has no create event. */
  const clientWith = (createdAt: Record<string, number | undefined>) =>
    ({
      getRoom: (roomId: string) => ({
        getLiveTimeline: () => ({
          getState: () => ({
            getStateEvents: () => {
              const ts = createdAt[roomId];
              return ts === undefined ? null : { getTs: () => ts };
            },
          }),
        }),
      }),
    }) as unknown as MatrixClient;

  it('puts the oldest space first, whatever order the client got them in', () => {
    // The server's first sync lists rooms by room ID.
    const client = clientWith({ '!a': 300, '!b': 100, '!c': 200 });
    expect(sortSpacesByAge(client, ['!a', '!b', '!c'])).toEqual(['!b', '!c', '!a']);
  });

  it('puts a space without a create event last, and ties in room ID order', () => {
    const client = clientWith({ '!x': undefined, '!b': 100, '!a': 100 });
    expect(sortSpacesByAge(client, ['!x', '!b', '!a'])).toEqual(['!a', '!b', '!x']);
  });
});
