import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { getViewedPlace } from './viewedPlace';

const ROOM = '!room:example.org';

describe('getViewedPlace', () => {
  const client = {
    getRooms: () => [
      { roomId: '!aliased:example.org', getCanonicalAlias: () => '#team:example.org' },
    ],
  } as unknown as MatrixClient;

  it('reads the room and thread from Home, Direct and Space room paths', () => {
    const encoded = encodeURIComponent(ROOM);
    expect(getViewedPlace(client, { pathname: `/home/${encoded}/`, search: '' })).toEqual({
      roomId: ROOM,
      threadId: undefined,
    });
    expect(
      getViewedPlace(client, {
        pathname: `/direct/${encoded}/`,
        search: `?threadId=${encodeURIComponent('$root')}`,
      })
    ).toEqual({ roomId: ROOM, threadId: '$root' });
    expect(
      getViewedPlace(client, {
        pathname: `/${encodeURIComponent('!space:example.org')}/${encoded}/$event/`,
        search: '',
      }).roomId
    ).toBe(ROOM);
  });

  it('reads the room and thread an Activity or Threads page shows beside its list', () => {
    expect(
      getViewedPlace(client, {
        pathname: `/activity/${encodeURIComponent('#team:example.org')}/`,
        search: `?threadId=${encodeURIComponent('$root')}`,
      })
    ).toEqual({ roomId: '!aliased:example.org', threadId: '$root' });
    expect(
      getViewedPlace(client, { pathname: `/threads/${encodeURIComponent(ROOM)}/`, search: '' })
        .roomId
    ).toBe(ROOM);
  });

  it('resolves an alias and finds no room on other pages', () => {
    expect(
      getViewedPlace(client, {
        pathname: `/home/${encodeURIComponent('#team:example.org')}/`,
        search: '',
      }).roomId
    ).toBe('!aliased:example.org');
    expect(getViewedPlace(client, { pathname: '/home/', search: '' })).toEqual({});
  });
});
