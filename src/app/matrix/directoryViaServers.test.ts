import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  boundDirectoryViaServers,
  getDirectoryViaServers,
  rememberDirectoryViaServers,
} from './directoryViaServers';

const makeClient = () => ({} as MatrixClient);

describe('boundDirectoryViaServers', () => {
  it('keeps the first five servers of a long list', () => {
    const servers = Array.from({ length: 500 }, (_, index) => `s${index}.example.org`);

    expect(boundDirectoryViaServers(servers)).toEqual(servers.slice(0, 5));
  });

  it('drops empty and repeated names, trims the rest, and keeps their order', () => {
    expect(
      boundDirectoryViaServers([
        '',
        ' one.example ',
        'two.example',
        'one.example',
        '   ',
        'three.example',
      ])
    ).toEqual(['one.example', 'two.example', 'three.example']);
  });

  it('counts five servers after the empty and repeated ones are gone', () => {
    expect(
      boundDirectoryViaServers([
        'a.example',
        'a.example',
        '',
        'b.example',
        'c.example',
        'd.example',
        'e.example',
        'f.example',
      ])
    ).toEqual(['a.example', 'b.example', 'c.example', 'd.example', 'e.example']);
  });

  it('gives no servers for an answer that is no list, and skips entries that are no text', () => {
    expect(boundDirectoryViaServers(undefined)).toEqual([]);
    expect(boundDirectoryViaServers('one.example')).toEqual([]);
    expect(boundDirectoryViaServers([null, 7, { server: 'x' }, 'one.example'])).toEqual([
      'one.example',
    ]);
  });
});

describe('rememberDirectoryViaServers', () => {
  it('gives back the bounded servers and keeps them for the room', () => {
    const mx = makeClient();
    const servers = Array.from({ length: 500 }, (_, index) => `s${index}.example.org`);

    expect(rememberDirectoryViaServers(mx, '!room:one.example', servers)).toEqual(
      servers.slice(0, 5)
    );
    expect(getDirectoryViaServers(mx, '!room:one.example')).toEqual(servers.slice(0, 5));
    expect(getDirectoryViaServers(mx, '!other:one.example')).toBeUndefined();
  });

  it('keeps nothing for an answer without servers, and leaves what the room had', () => {
    const mx = makeClient();

    expect(rememberDirectoryViaServers(mx, '!room:one.example', undefined)).toEqual([]);
    expect(getDirectoryViaServers(mx, '!room:one.example')).toBeUndefined();

    rememberDirectoryViaServers(mx, '!room:one.example', ['one.example']);
    expect(rememberDirectoryViaServers(mx, '!room:one.example', ['', ' '])).toEqual([]);
    expect(getDirectoryViaServers(mx, '!room:one.example')).toEqual(['one.example']);
  });

  it('replaces the servers of a room with those of a later answer', () => {
    const mx = makeClient();
    rememberDirectoryViaServers(mx, '!room:one.example', ['one.example']);
    rememberDirectoryViaServers(mx, '!room:one.example', ['two.example']);

    expect(getDirectoryViaServers(mx, '!room:one.example')).toEqual(['two.example']);
  });

  it('keeps each client its own servers', () => {
    const first = makeClient();
    const second = makeClient();
    rememberDirectoryViaServers(first, '!room:one.example', ['one.example']);
    rememberDirectoryViaServers(second, '!room:one.example', ['two.example']);

    expect(getDirectoryViaServers(first, '!room:one.example')).toEqual(['one.example']);
    expect(getDirectoryViaServers(second, '!room:one.example')).toEqual(['two.example']);
    expect(getDirectoryViaServers(makeClient(), '!room:one.example')).toBeUndefined();
  });

  it('hands out copies, so a caller cannot change what is kept', () => {
    const mx = makeClient();
    const given = ['one.example'];
    const returned = rememberDirectoryViaServers(mx, '!room:one.example', given);
    given.push('given.example');
    returned.push('returned.example');
    getDirectoryViaServers(mx, '!room:one.example')?.push('read.example');

    expect(getDirectoryViaServers(mx, '!room:one.example')).toEqual(['one.example']);
  });

  it('keeps 64 rooms: the one remembered longest ago goes first', () => {
    const mx = makeClient();
    const room = (index: number) => `!room${index}:one.example`;
    for (let index = 0; index < 64; index += 1) {
      rememberDirectoryViaServers(mx, room(index), [`s${index}.example`]);
    }
    expect(getDirectoryViaServers(mx, room(0))).toEqual(['s0.example']);

    // Remembered again, the first room is the newest; the second is now the oldest.
    rememberDirectoryViaServers(mx, room(0), ['again.example']);
    rememberDirectoryViaServers(mx, room(64), ['s64.example']);

    expect(getDirectoryViaServers(mx, room(0))).toEqual(['again.example']);
    expect(getDirectoryViaServers(mx, room(1))).toBeUndefined();
    expect(getDirectoryViaServers(mx, room(2))).toEqual(['s2.example']);
    expect(getDirectoryViaServers(mx, room(64))).toEqual(['s64.example']);
  });
});
