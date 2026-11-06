import { describe, expect, it } from 'vitest';
import {
  getJoinedSubspaces,
  getSpaceOwnRooms,
  getSpaceSearchRooms,
  mergeRoomToParentsSources,
  mergeSearchRoomSources,
} from './useSpaceSearchRooms';

describe('mergeSearchRoomSources', () => {
  it('deduplicates room ids across sdk and atom sources', () => {
    expect(
      mergeSearchRoomSources(
        ['!space-child:example.org', '!sdk-only:example.org'],
        ['!space-child:example.org', '!atom-only:example.org']
      )
    ).toEqual(['!space-child:example.org', '!sdk-only:example.org', '!atom-only:example.org']);
  });
});

describe('mergeRoomToParentsSources', () => {
  it('unions parent relationships from atom and sdk sources', () => {
    const merged = mergeRoomToParentsSources(
      new Map([['!room:example.org', new Set(['!space-a:example.org'])]]),
      new Map([['!room:example.org', new Set(['!space-b:example.org'])]])
    );

    expect(Array.from(merged.get('!room:example.org') ?? [])).toEqual([
      '!space-a:example.org',
      '!space-b:example.org',
    ]);
  });
});

describe('getSpaceSearchRooms', () => {
  it('includes recursive child rooms from merged space-parent state', () => {
    const mx = {
      getRoom: (roomId: string) =>
        roomId === '!space:example.org'
          ? ({
              getLiveTimeline: () => ({
                getState: () => ({
                  getStateEvents: () => ({
                    getContent: () => ({ type: 'm.space' }),
                  }),
                }),
              }),
            } as never)
          : ({
              getLiveTimeline: () => ({
                getState: () => ({
                  getStateEvents: () => undefined,
                }),
              }),
            } as never),
    } as never;

    expect(
      getSpaceSearchRooms(
        mx,
        '!space:example.org',
        ['!room:example.org', '!dm:example.org'],
        new Set(['!dm:example.org']),
        new Map([['!room:example.org', new Set(['!space:example.org'])]])
      )
    ).toEqual(['!room:example.org']);
  });
});

describe('a space and its sub-spaces', () => {
  // A parent holding one room and a sub-space; the sub-space holds a room and a DM.
  const SPACE_TYPE = { getContent: () => ({ type: 'm.space' }) };
  const room = (space: boolean) =>
    ({
      getLiveTimeline: () => ({
        getState: () => ({ getStateEvents: () => (space ? SPACE_TYPE : undefined) }),
      }),
    } as never);
  const spaces = new Set(['!parent:example.org', '!sub:example.org']);
  const mx = { getRoom: (roomId: string) => room(spaces.has(roomId)) } as never;
  const joined = [
    '!parent:example.org',
    '!sub:example.org',
    '!own:example.org',
    '!deep:example.org',
    '!dm:example.org',
  ];
  const parents = new Map([
    ['!sub:example.org', new Set(['!parent:example.org'])],
    ['!own:example.org', new Set(['!parent:example.org'])],
    ['!deep:example.org', new Set(['!sub:example.org'])],
    ['!dm:example.org', new Set(['!sub:example.org'])],
  ]);
  const directs = new Set(['!dm:example.org']);

  it('lists only the rooms a space holds directly, without sub-spaces or DMs', () => {
    expect(getSpaceOwnRooms(mx, '!parent:example.org', joined, directs, parents)).toEqual([
      '!own:example.org',
    ]);
    expect(getSpaceOwnRooms(mx, '!sub:example.org', joined, directs, parents)).toEqual([
      '!deep:example.org',
    ]);
  });

  it('lists the joined sub-spaces a space holds directly', () => {
    expect(getJoinedSubspaces(mx, '!parent:example.org', joined, parents)).toEqual([
      '!sub:example.org',
    ]);
    expect(getJoinedSubspaces(mx, '!sub:example.org', joined, parents)).toEqual([]);
  });
});
