import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
} from './clientRouteRestore';

type LookUp = (alias: string) => Promise<{ room_id?: string }>;

const room = (roomId: string, canonicalAlias: string | null, altAliases: string[] = []) => ({
  roomId,
  getCanonicalAlias: () => canonicalAlias,
  getAltAliases: () => altAliases,
});

const clientWith = (
  rooms: ReturnType<typeof room>[],
  lookUp = vi.fn<LookUp>().mockRejectedValue(new Error('no lookup expected'))
) => ({
  client: { getRooms: () => rooms, getRoomIdForAlias: lookUp } as unknown as MatrixClient,
  lookUp,
});

// A client without methods: calling any of them throws.
const noClient = {} as MatrixClient;

describe('clientRouteRestore behaviour', () => {
  it('drops the trailing slash of matched paths and returns unmatched paths unchanged', () => {
    expect(canonicalizeSessionPathname(noClient, '/home/')).toBe('/home');
    expect(canonicalizeSessionPathname(noClient, '/activity/invites/')).toBe('/activity/invites');
    expect(canonicalizeSessionPathname(noClient, '/home/!room%3Aexample.org')).toBe(
      '/home/!room%3Aexample.org'
    );
    expect(canonicalizeSessionPathname(noClient, '/')).toBe('/');
    expect(canonicalizeSessionPathname(noClient, '/a/b/c/d/')).toBe('/a/b/c/d/');
  });

  it('keeps the event segment and encodes it again', () => {
    const { client } = clientWith([room('!id:x', '#r:x')]);

    expect(canonicalizeSessionPathname(client, '/home/%23r%3Ax/%24e%3Ax/')).toBe(
      '/home/!id%3Ax/%24e%3Ax'
    );
  });

  it('replaces an alias found only among the alternative aliases of a room', async () => {
    const { client, lookUp } = clientWith([room('!id:x', '#main:x', ['#old:x'])]);

    expect(canonicalizeSessionPathname(client, '/direct/%23old%3Ax/')).toBe('/direct/!id%3Ax');
    await expect(resolveCanonicalizedPathname(client, '/direct/%23old%3Ax/')).resolves.toBe(
      '/direct/!id%3Ax'
    );
    expect(lookUp).not.toHaveBeenCalled();
  });

  it('takes a malformed escape as text instead of throwing', () => {
    expect(canonicalizeSessionPathname(noClient, '/home/%E0%A4%A/')).toBe('/home/%25E0%25A4%25A');
    expect(pathnameContainsAliasRoute('/home/%E0%A4%A/')).toBe(false);
  });

  it('keeps an alias the directory cannot resolve and looks up only unknown aliases', async () => {
    const { client, lookUp } = clientWith(
      [room('!known:x', '#known:x')],
      vi.fn<LookUp>(async (alias) => {
        if (alias === '#gone:x') throw new Error('M_NOT_FOUND');
        return {};
      })
    );

    await expect(resolveCanonicalizedPathname(client, '/%23gone%3Ax/%23empty%3Ax/')).resolves.toBe(
      '/%23gone%3Ax/%23empty%3Ax'
    );
    await expect(resolveCanonicalizedPathname(client, '/%23known%3Ax/%23empty%3Ax/')).resolves.toBe(
      '/!known%3Ax/%23empty%3Ax'
    );
    expect(lookUp.mock.calls).toEqual([['#gone:x'], ['#empty:x'], ['#empty:x']]);
  });

  it('starts both lookups of a space room route before either answers', async () => {
    const answers = new Map<string, (answer: { room_id: string }) => void>();
    const { client, lookUp } = clientWith(
      [],
      vi.fn<LookUp>(
        (alias) =>
          new Promise((resolve) => {
            answers.set(alias, resolve);
          })
      )
    );

    const resolved = resolveCanonicalizedPathname(client, '/%23s%3Ax/%23r%3Ax/%24e%3Ax');
    expect(lookUp).toHaveBeenCalledTimes(2);
    answers.get('#r:x')?.({ room_id: '!r:x' });
    answers.get('#s:x')?.({ room_id: '!s:x' });

    await expect(resolved).resolves.toBe('/!s%3Ax/!r%3Ax/%24e%3Ax');
  });

  it('rejects when reading the client throws, and only then', async () => {
    await expect(resolveCanonicalizedPathname(noClient, '/home/%23r%3Ax/')).rejects.toThrow(
      TypeError
    );
    await expect(resolveCanonicalizedPathname(noClient, '/home/!r%3Ax/')).resolves.toBe(
      '/home/!r%3Ax'
    );
  });

  it('ignores aliases in the event segment and matches route names case-sensitively', () => {
    const { client } = clientWith([room('!id:x', '#r:x'), room('!a:x', '#a:x')]);

    expect(pathnameContainsAliasRoute('/home/!r%3Ax/%23a%3Ax/')).toBe(false);
    expect(pathnameContainsAliasRoute('/!s%3Ax/!r%3Ax/%23a%3Ax/')).toBe(false);
    expect(canonicalizeSessionPathname(client, '/home/!r%3Ax/%23a%3Ax/')).toBe(
      '/home/!r%3Ax/%23a%3Ax'
    );

    // `HOME` is a space here, not the Home section.
    expect(pathnameContainsAliasRoute('/HOME/%23r%3Ax/')).toBe(true);
    expect(canonicalizeSessionPathname(client, '/HOME/%23r%3Ax/')).toBe('/HOME/!id%3Ax');
  });

  it('rewrites the space of space, lobby and search routes', () => {
    const { client } = clientWith([room('!s:x', '#s:x')]);

    expect(pathnameContainsAliasRoute('/%23s%3Ax/')).toBe(true);
    expect(canonicalizeSessionPathname(client, '/%23s%3Ax/')).toBe('/!s%3Ax');
    expect(canonicalizeSessionPathname(client, '/%23s%3Ax/lobby/')).toBe('/!s%3Ax/lobby');
    expect(canonicalizeSessionPathname(client, '/%23s%3Ax/search/')).toBe('/!s%3Ax/search');
  });
});
