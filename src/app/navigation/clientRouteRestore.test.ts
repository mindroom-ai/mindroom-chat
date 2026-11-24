import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getDirectoryViaServers } from '../matrix/directoryViaServers';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
  resolveCanonicalizedRoute,
} from './clientRouteRestore';

const makeRoom = (roomId: string, alias?: string) => ({
  roomId,
  getCanonicalAlias: () => alias,
});

/** What the directory answers for an alias: its room ID, with the servers it names if any. */
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
      return typeof answer === 'object' ? answer : { room_id: answer };
    }),
  }) as unknown as MatrixClient;

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

  describe('the servers the directory names for a room', () => {
    it('are returned per resolved room ID without mutating the cache or the address', async () => {
      const mx = makeMatrixClient({
        resolvedAliases: {
          '#field-notes:remote.example.org': {
            room_id: '!field-notes:remote.example.org',
            servers: ['remote.example.org', 'relay.example.org'],
          },
        },
      });

      const resolved = await resolveCanonicalizedRoute(
        mx,
        '/home/%23field-notes%3Aremote.example.org/'
      );
      expect(resolved).toEqual({
        pathname: '/home/!field-notes%3Aremote.example.org',
        directoryVia: [
          {
            roomId: '!field-notes:remote.example.org',
            servers: ['remote.example.org', 'relay.example.org'],
          },
        ],
      });
      expect(resolved.pathname).not.toContain('?');
      expect(getDirectoryViaServers(mx, '!field-notes:remote.example.org')).toBeUndefined();
    });

    it('are returned separately for the space and for the room below it', async () => {
      const mx = makeMatrixClient({
        resolvedAliases: {
          '#space:one.example': { room_id: '!space:one.example', servers: ['one.example'] },
          '#room:two.example': { room_id: '!room:two.example', servers: ['two.example'] },
        },
      });

      const resolved = await resolveCanonicalizedRoute(
        mx,
        '/%23space%3Aone.example/%23room%3Atwo.example/'
      );
      expect(resolved.pathname).toBe('/!space%3Aone.example/!room%3Atwo.example');
      expect(resolved.directoryVia).toEqual([
        { roomId: '!space:one.example', servers: ['one.example'] },
        { roomId: '!room:two.example', servers: ['two.example'] },
      ]);
    });

    it('are omitted for rooms the directory was not asked about or answered without servers', async () => {
      const mx = makeMatrixClient({
        rooms: [makeRoom('!known:one.example', '#known:one.example')],
        resolvedAliases: {
          '#room:two.example': { room_id: '!room:two.example', servers: ['two.example'] },
          '#bare:three.example': '!bare:three.example',
        },
      });

      const nested = await resolveCanonicalizedRoute(
        mx,
        '/!space%3Aone.example/%23room%3Atwo.example/'
      );
      const known = await resolveCanonicalizedRoute(mx, '/home/%23known%3Aone.example/');
      const bare = await resolveCanonicalizedRoute(mx, '/home/%23bare%3Athree.example/');

      expect(nested.directoryVia).toEqual([
        { roomId: '!room:two.example', servers: ['two.example'] },
      ]);
      expect(known.directoryVia).toEqual([]);
      expect(bare.directoryVia).toEqual([]);
    });

    it('are omitted when the lookup fails', async () => {
      const mx = makeMatrixClient();
      vi.mocked(mx.getRoomIdForAlias).mockRejectedValue(new Error('M_NOT_FOUND'));

      await expect(
        resolveCanonicalizedRoute(mx, '/home/%23gone%3Aremote.example.org/')
      ).resolves.toEqual({
        pathname: '/home/%23gone%3Aremote.example.org',
        directoryVia: [],
      });
    });
  });
});
