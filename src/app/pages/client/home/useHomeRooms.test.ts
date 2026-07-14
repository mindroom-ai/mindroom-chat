import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  getHomeNavigationRooms,
  getHomeSearchRooms,
  mergeHomeSearchRoomSources,
} from './useHomeRooms';

describe('getHomeSearchRooms', () => {
  it('filters directs, child rooms, and known spaces from the search scope', () => {
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
          : null,
    } as never;

    expect(
      getHomeSearchRooms(
        mx,
        ['!root:example.org', '!space:example.org', '!child:example.org', '!dm:example.org'],
        new Set(['!dm:example.org']),
        new Map([['!child:example.org', new Set(['!space:example.org'])]])
      )
    ).toEqual(['!root:example.org']);
  });

  it('deduplicates room ids when multiple room sources are merged upstream', () => {
    expect(
      mergeHomeSearchRoomSources(
        ['!root:example.org', '!sdk-only:example.org'],
        ['!root:example.org', '!other:example.org']
      )
    ).toEqual(['!root:example.org', '!sdk-only:example.org', '!other:example.org']);
  });
});

describe('getHomeNavigationRooms', () => {
  it('includes Matrix-space children and spaces but excludes direct messages', () => {
    const makeRoom = (type?: string) => ({
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: () => ({ getContent: () => ({ type }) }),
        }),
      }),
    });
    const rooms = new Map([
      ['!orphan:example.org', makeRoom()],
      ['!space-child:example.org', makeRoom()],
      ['!direct:example.org', makeRoom()],
      ['!space:example.org', makeRoom('m.space')],
    ]);
    const mx = { getRoom: (roomId: string) => rooms.get(roomId) } as unknown as MatrixClient;

    expect(
      getHomeNavigationRooms(mx, Array.from(rooms.keys()), new Set(['!direct:example.org']))
    ).toEqual({
      roomIds: ['!orphan:example.org', '!space-child:example.org'],
      spaceIds: ['!space:example.org'],
    });
  });

  it('flattens rooms and hides Space headers in simple mode', () => {
    const makeRoom = (type?: string) => ({
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: () => ({ getContent: () => ({ type }) }),
        }),
      }),
    });
    const rooms = new Map([
      ['!space-child:example.org', makeRoom()],
      ['!space:example.org', makeRoom('m.space')],
    ]);
    const mx = { getRoom: (roomId: string) => rooms.get(roomId) } as unknown as MatrixClient;

    expect(getHomeNavigationRooms(mx, Array.from(rooms.keys()), new Set(), true)).toEqual({
      roomIds: ['!space-child:example.org'],
      spaceIds: [],
    });
  });
});
