import { describe, expect, it } from 'vitest';
import { type DirectoryRoom, filterDirectoryRooms, parseJoinAddress } from './joinAddress';

describe('parseJoinAddress', () => {
  it('reads a room alias and a room ID, ignoring spaces around them', () => {
    expect(parseJoinAddress('#lounge:example.org')).toEqual({
      roomIdOrAlias: '#lounge:example.org',
    });
    expect(parseJoinAddress('  !abc123:example.org \n')).toEqual({
      roomIdOrAlias: '!abc123:example.org',
    });
  });

  it('reads matrix.to links to a room, with their routing servers, and to an event', () => {
    expect(parseJoinAddress('https://matrix.to/#/#lounge:example.org')).toEqual({
      roomIdOrAlias: '#lounge:example.org',
      viaServers: [],
    });
    expect(
      parseJoinAddress('https://matrix.to/#/!abc123:example.org?via=example.org&via=other.net')
    ).toEqual({ roomIdOrAlias: '!abc123:example.org', viaServers: ['example.org', 'other.net'] });
    expect(
      parseJoinAddress('https://matrix.to/#/!abc123:example.org/$event1?via=example.org')
    ).toEqual({
      roomIdOrAlias: '!abc123:example.org',
      eventId: '$event1',
      viaServers: ['example.org'],
    });
  });

  it('leaves search words, half-typed aliases, users and other links as a search', () => {
    ['lounge', '#lounge', 'lounge:example.org', '@ada:example.org', 'https://example.org/#/x', '']
      .concat(['https://matrix.to/#/@ada:example.org'])
      .forEach((text) => expect(parseJoinAddress(text), text).toBeUndefined());
  });
});

const room = (fields: Partial<DirectoryRoom> & { room_id: string }): DirectoryRoom => ({
  num_joined_members: 1,
  world_readable: false,
  guest_can_join: false,
  ...fields,
});

const ROOMS: DirectoryRoom[] = [
  room({ room_id: '!a:x', name: 'Design Crew', topic: 'Sketches and reviews' }),
  room({ room_id: '!b:x', name: 'Lounge', canonical_alias: '#hangout:x' }),
  room({ room_id: '!c:x', name: 'Release notes', aliases: ['#changelog:x'] }),
  room({ room_id: '!d:x', name: 'Design space', room_type: 'm.space' }),
];

const ids = (rooms: DirectoryRoom[]) => rooms.map((entry) => entry.room_id);

describe('filterDirectoryRooms', () => {
  it('lists every room but no spaces when there is no search text', () => {
    expect(ids(filterDirectoryRooms(ROOMS, ''))).toEqual(['!a:x', '!b:x', '!c:x']);
    expect(ids(filterDirectoryRooms(ROOMS, '   '))).toEqual(['!a:x', '!b:x', '!c:x']);
  });

  it('matches the name, the addresses and the topic, ignoring case', () => {
    expect(ids(filterDirectoryRooms(ROOMS, 'design'))).toEqual(['!a:x']);
    expect(ids(filterDirectoryRooms(ROOMS, 'HANGOUT'))).toEqual(['!b:x']);
    expect(ids(filterDirectoryRooms(ROOMS, 'changelog'))).toEqual(['!c:x']);
    expect(ids(filterDirectoryRooms(ROOMS, ' reviews '))).toEqual(['!a:x']);
  });

  it('matches the whole text, the way the server searches', () => {
    expect(ids(filterDirectoryRooms(ROOMS, 'design crew'))).toEqual(['!a:x']);
    expect(ids(filterDirectoryRooms(ROOMS, 'crew design'))).toEqual([]);
    expect(ids(filterDirectoryRooms(ROOMS, 'nothing like it'))).toEqual([]);
  });
});
