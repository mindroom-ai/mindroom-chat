import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getDirectoryViaServers } from '../matrix/directoryViaServers';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
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

  describe('the servers the directory names for a room', () => {
    const manyServers = Array.from({ length: 500 }, (_, index) => `s${index}.example.org`);

    it('are remembered for the room ID, bounded, and stay out of the address', async () => {
      const mx = makeMatrixClient({
        resolvedAliases: {
          '#field-notes:remote.example.org': {
            room_id: '!field-notes:remote.example.org',
            servers: ['remote.example.org', '', 'relay.example.org', 'remote.example.org'],
          },
          '#crowded:remote.example.org': {
            room_id: '!crowded:remote.example.org',
            servers: manyServers,
          },
        },
      });

      const resolved = await resolveCanonicalizedPathname(
        mx,
        '/home/%23field-notes%3Aremote.example.org/'
      );
      expect(resolved).toBe('/home/!field-notes%3Aremote.example.org');
      expect(resolved).not.toContain('?');
      expect(getDirectoryViaServers(mx, '!field-notes:remote.example.org')).toEqual([
        'remote.example.org',
        'relay.example.org',
      ]);

      await expect(
        resolveCanonicalizedPathname(mx, '/home/%23crowded%3Aremote.example.org/')
      ).resolves.toBe('/home/!crowded%3Aremote.example.org');
      expect(getDirectoryViaServers(mx, '!crowded:remote.example.org')).toEqual(
        manyServers.slice(0, 5)
      );
    });

    it('are remembered for the space and for the room below it, each its own', async () => {
      const mx = makeMatrixClient({
        resolvedAliases: {
          '#space:one.example': { room_id: '!space:one.example', servers: ['one.example'] },
          '#room:two.example': { room_id: '!room:two.example', servers: ['two.example'] },
        },
      });

      await expect(
        resolveCanonicalizedPathname(mx, '/%23space%3Aone.example/%23room%3Atwo.example/')
      ).resolves.toBe('/!space%3Aone.example/!room%3Atwo.example');

      expect(getDirectoryViaServers(mx, '!space:one.example')).toEqual(['one.example']);
      expect(getDirectoryViaServers(mx, '!room:two.example')).toEqual(['two.example']);
    });

    it('are remembered for no room the directory was not asked about', async () => {
      const mx = makeMatrixClient({
        rooms: [makeRoom('!known:one.example', '#known:one.example')],
        resolvedAliases: {
          '#room:two.example': { room_id: '!room:two.example', servers: ['two.example'] },
          '#bare:three.example': '!bare:three.example',
        },
      });

      // A space named by its room ID, an alias the client knows, and an answer without servers.
      await resolveCanonicalizedPathname(mx, '/!space%3Aone.example/%23room%3Atwo.example/');
      await resolveCanonicalizedPathname(mx, '/home/%23known%3Aone.example/');
      await resolveCanonicalizedPathname(mx, '/home/%23bare%3Athree.example/');

      expect(getDirectoryViaServers(mx, '!space:one.example')).toBeUndefined();
      expect(getDirectoryViaServers(mx, '!known:one.example')).toBeUndefined();
      expect(getDirectoryViaServers(mx, '!bare:three.example')).toBeUndefined();
      expect(getDirectoryViaServers(mx, '!room:two.example')).toEqual(['two.example']);
    });

    it('are remembered for nothing when the lookup fails', async () => {
      const mx = makeMatrixClient();
      vi.mocked(mx.getRoomIdForAlias).mockRejectedValue(new Error('M_NOT_FOUND'));

      await expect(
        resolveCanonicalizedPathname(mx, '/home/%23gone%3Aremote.example.org/')
      ).resolves.toBe('/home/%23gone%3Aremote.example.org');
      expect(getDirectoryViaServers(mx, '#gone:remote.example.org')).toBeUndefined();
    });
  });
});
