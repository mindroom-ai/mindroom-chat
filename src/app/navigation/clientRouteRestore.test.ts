import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
  resolveCanonicalizedRoute,
} from './clientRouteRestore';

const makeRoom = (roomId: string, alias?: string, membership?: string) => ({
  roomId,
  getCanonicalAlias: () => alias,
  ...(membership ? { getMyMembership: () => membership } : {}),
});

type DirectoryAnswer = string | { room_id?: string; servers?: string[] };

const makeMatrixClient = ({
  rooms = [],
  resolvedAliases = {},
}: {
  rooms?: Array<ReturnType<typeof makeRoom>>;
  resolvedAliases?: Record<string, DirectoryAnswer>;
} = {}) =>
  ({
    getRooms: () => rooms,
    getRoomIdForAlias: vi.fn(async (alias: string) => {
      const answer = resolvedAliases[alias];
      if (typeof answer === 'string') return { room_id: answer };
      return answer ?? {};
    }),
  } as unknown as MatrixClient);

describe('clientRouteRestore', () => {
  it('detects alias routes before rendering children that would flash join fallbacks', () => {
    expect(pathnameContainsAliasRoute('/home/%23room%3Amindroom.chat/')).toBe(true);
    expect(pathnameContainsAliasRoute('/%23space%3Amindroom.chat/%21room%3Amindroom.chat/')).toBe(
      true
    );
    expect(pathnameContainsAliasRoute('/home/%21room%3Amindroom.chat/')).toBe(false);
  });

  it('canonicalizes known aliases before persisting the active session path', () => {
    const mx = makeMatrixClient({
      rooms: [
        makeRoom('!space:mindroom.chat', '#space:mindroom.chat'),
        makeRoom('!room:mindroom.chat', '#room:mindroom.chat'),
      ],
    });

    expect(
      canonicalizeSessionPathname(mx, '/%23space%3Amindroom.chat/%23room%3Amindroom.chat/')
    ).toBe('/!space%3Amindroom.chat/!room%3Amindroom.chat');
  });

  it('resolves unknown aliases through the homeserver before replacing the visible route', async () => {
    const mx = makeMatrixClient({
      resolvedAliases: {
        '#space:mindroom.chat': '!space:mindroom.chat',
        '#room:mindroom.chat': '!room:mindroom.chat',
      },
    });

    await expect(
      resolveCanonicalizedPathname(mx, '/%23space%3Amindroom.chat/%23room%3Amindroom.chat/')
    ).resolves.toBe('/!space%3Amindroom.chat/!room%3Amindroom.chat');

    expect(mx.getRoomIdForAlias).toHaveBeenCalledWith('#space:mindroom.chat');
    expect(mx.getRoomIdForAlias).toHaveBeenCalledWith('#room:mindroom.chat');
  });

  it('preserves directory servers as viaServers in search for an unjoined remote alias', async () => {
    const mx = makeMatrixClient({
      resolvedAliases: {
        '#field-notes:remote.example.org': {
          room_id: '!field-notes:remote.example.org',
          servers: ['remote.example.org', '', 'relay.example.org'],
        },
      },
    });

    await expect(
      resolveCanonicalizedRoute(mx, '/home/%23field-notes%3Aremote.example.org/')
    ).resolves.toEqual({
      pathname: '/home/!field-notes%3Aremote.example.org',
      search: '?viaServers=remote.example.org%2Crelay.example.org',
    });
  });

  it('preserves existing query params such as threadId when appending viaServers', async () => {
    const mx = makeMatrixClient({
      resolvedAliases: {
        '#field-notes:remote.example.org': {
          room_id: '!field-notes:remote.example.org',
          servers: ['remote.example.org'],
        },
      },
    });

    await expect(
      resolveCanonicalizedRoute(
        mx,
        '/home/%23field-notes%3Aremote.example.org/',
        '?threadId=%24root'
      )
    ).resolves.toEqual({
      pathname: '/home/!field-notes%3Aremote.example.org',
      search: '?threadId=%24root&viaServers=remote.example.org',
    });
  });

  it('does not overwrite existing viaServers or via query parameters', async () => {
    const mx = makeMatrixClient({
      resolvedAliases: {
        '#field-notes:remote.example.org': {
          room_id: '!field-notes:remote.example.org',
          servers: ['remote.example.org'],
        },
      },
    });

    await expect(
      resolveCanonicalizedRoute(
        mx,
        '/home/%23field-notes%3Aremote.example.org/',
        '?viaServers=preferred.example.org'
      )
    ).resolves.toEqual({
      pathname: '/home/!field-notes%3Aremote.example.org',
      search: '?viaServers=preferred.example.org',
    });

    await expect(
      resolveCanonicalizedRoute(
        mx,
        '/home/%23field-notes%3Aremote.example.org/',
        '?via=preferred.example.org'
      )
    ).resolves.toEqual({
      pathname: '/home/!field-notes%3Aremote.example.org',
      search: '?via=preferred.example.org',
    });
  });

  it('does not add viaServers when the resolved room is already joined', async () => {
    const mx = makeMatrixClient({
      rooms: [makeRoom('!field-notes:remote.example.org', undefined, KnownMembership.Join)],
      resolvedAliases: {
        '#field-notes:remote.example.org': {
          room_id: '!field-notes:remote.example.org',
          servers: ['remote.example.org'],
        },
      },
    });

    await expect(
      resolveCanonicalizedRoute(mx, '/home/%23field-notes%3Aremote.example.org/')
    ).resolves.toEqual({
      pathname: '/home/!field-notes%3Aremote.example.org',
      search: '',
    });
  });

  describe('on a space room route', () => {
    // Disjoint servers, so each answer shows whose servers the route carries.
    const resolvedAliases = {
      '#space:space.example.org': {
        room_id: '!space:space.example.org',
        servers: ['space.example.org'],
      },
      '#room:room.example.org': {
        room_id: '!room:room.example.org',
        servers: ['room.example.org'],
      },
    };

    it("carries the space's own servers while neither the space nor the room is joined", async () => {
      const mx = makeMatrixClient({ resolvedAliases });

      // The space's join page comes first, so the servers are the ones that reach the space.
      await expect(
        resolveCanonicalizedRoute(mx, '/%23space%3Aspace.example.org/%23room%3Aroom.example.org/')
      ).resolves.toEqual({
        pathname: '/!space%3Aspace.example.org/!room%3Aroom.example.org',
        search: '?viaServers=space.example.org',
      });
    });

    it("never lends the room's servers to an unjoined space named by its room ID", async () => {
      const mx = makeMatrixClient({ resolvedAliases });

      await expect(
        resolveCanonicalizedRoute(mx, '/!space%3Aspace.example.org/%23room%3Aroom.example.org/')
      ).resolves.toEqual({
        pathname: '/!space%3Aspace.example.org/!room%3Aroom.example.org',
        search: '',
      });
      expect(mx.getRoomIdForAlias).toHaveBeenCalledTimes(1);
      expect(mx.getRoomIdForAlias).toHaveBeenCalledWith('#room:room.example.org');
    });

    it("never lends the room's servers to an unjoined space whose alias lookup failed", async () => {
      const mx = makeMatrixClient({
        resolvedAliases: { '#room:room.example.org': resolvedAliases['#room:room.example.org'] },
      });

      await expect(
        resolveCanonicalizedRoute(mx, '/%23space%3Aspace.example.org/%23room%3Aroom.example.org/')
      ).resolves.toEqual({
        pathname: '/%23space%3Aspace.example.org/!room%3Aroom.example.org',
        search: '',
      });
    });

    it("carries the room's servers once the space is joined", async () => {
      // By the space's room ID, and by an alias the directory resolves to the joined space.
      const mx = makeMatrixClient({
        rooms: [makeRoom('!space:space.example.org', undefined, KnownMembership.Join)],
        resolvedAliases,
      });
      const expected = {
        pathname: '/!space%3Aspace.example.org/!room%3Aroom.example.org',
        search: '?viaServers=room.example.org',
      };

      await expect(
        resolveCanonicalizedRoute(mx, '/!space%3Aspace.example.org/%23room%3Aroom.example.org/')
      ).resolves.toEqual(expected);
      await expect(
        resolveCanonicalizedRoute(mx, '/%23space%3Aspace.example.org/%23room%3Aroom.example.org/')
      ).resolves.toEqual(expected);
    });

    it('carries no servers when the space and the room are both joined', async () => {
      const mx = makeMatrixClient({
        rooms: [
          makeRoom('!space:space.example.org', undefined, KnownMembership.Join),
          makeRoom('!room:room.example.org', undefined, KnownMembership.Join),
        ],
        resolvedAliases,
      });

      await expect(
        resolveCanonicalizedRoute(mx, '/%23space%3Aspace.example.org/%23room%3Aroom.example.org/')
      ).resolves.toEqual({
        pathname: '/!space%3Aspace.example.org/!room%3Aroom.example.org',
        search: '',
      });
    });

    it("carries the space's servers on its own route and on its lobby", async () => {
      const mx = makeMatrixClient({ resolvedAliases });

      await expect(
        resolveCanonicalizedRoute(mx, '/%23space%3Aspace.example.org/')
      ).resolves.toEqual({
        pathname: '/!space%3Aspace.example.org',
        search: '?viaServers=space.example.org',
      });
      await expect(
        resolveCanonicalizedRoute(mx, '/%23space%3Aspace.example.org/lobby/')
      ).resolves.toEqual({
        pathname: '/!space%3Aspace.example.org/lobby',
        search: '?viaServers=space.example.org',
      });
    });
  });
});
