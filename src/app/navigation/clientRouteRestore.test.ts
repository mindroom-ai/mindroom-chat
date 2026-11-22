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

  it('uses the target room servers rather than space servers on space room routes', async () => {
    const mx = makeMatrixClient({
      resolvedAliases: {
        '#harbor-space:space.example.org': {
          room_id: '!harbor-space:space.example.org',
          servers: ['space.example.org'],
        },
        '#field-notes:remote.example.org': {
          room_id: '!field-notes:remote.example.org',
          servers: ['remote.example.org'],
        },
      },
    });

    await expect(
      resolveCanonicalizedRoute(
        mx,
        '/%23harbor-space%3Aspace.example.org/%23field-notes%3Aremote.example.org/'
      )
    ).resolves.toEqual({
      pathname: '/!harbor-space%3Aspace.example.org/!field-notes%3Aremote.example.org',
      search: '?viaServers=remote.example.org',
    });

    await expect(
      resolveCanonicalizedRoute(
        mx,
        '/%23harbor-space%3Aspace.example.org/!direct-room%3Aexample.org/'
      )
    ).resolves.toEqual({
      pathname: '/!harbor-space%3Aspace.example.org/!direct-room%3Aexample.org',
      search: '',
    });
  });
});
