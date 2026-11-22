import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AsyncStatus } from '../lib/hooks/useAsyncCallback';
import { getDirectoryViaServers, rememberDirectoryViaServers } from '../matrix/directoryViaServers';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { RoomSummaryLoader, type RoomSummaryState } from './RoomSummaryLoader';

const summary = {
  room_id: '!private:remote.example.org',
  name: 'Private room',
  join_rule: 'knock',
};

describe('RoomSummaryLoader', () => {
  it('reports loading, success, and a failed refetch while using federation hints', async () => {
    let resolveSummary: ((value: typeof summary) => void) | undefined;
    const getRoomSummary = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<typeof summary>((resolve) => {
            resolveSummary = resolve;
          })
      )
      .mockRejectedValueOnce(new Error('Summary unavailable'));
    const mx = { getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observedStatuses: AsyncStatus[] = [];
    let retrySummary: (() => void) | undefined;
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader
              roomIdOrAlias="!private:remote.example.org"
              viaServers={['one.example.org', 'two.example.org']}
            >
              {(state, retry) => {
                observedStatuses.push(state.status);
                retrySummary = retry;
                return <span>{state.status}</span>;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    expect(observedStatuses.at(-1)).toBe(AsyncStatus.Loading);
    expect(getRoomSummary).toHaveBeenCalledWith('!private:remote.example.org', [
      'one.example.org',
      'two.example.org',
    ]);

    await act(async () => {
      resolveSummary?.(summary);
    });
    await act(async () => {
      await vi.waitFor(() => expect(observedStatuses.at(-1)).toBe(AsyncStatus.Success));
    });

    expect(observedStatuses.at(-1)).toBe(AsyncStatus.Success);
    act(() => retrySummary?.());
    await act(async () => {
      await vi.waitFor(() => expect(observedStatuses.at(-1)).toBe(AsyncStatus.Error));
    });

    act(() => renderer!.unmount());
    queryClient.clear();
  });

  it('resolves an alias and exposes its routing servers with the concrete summary', async () => {
    const servers = ['one.example.org', 'two.example.org'];
    const getRoomIdForAlias = vi.fn(async () => ({
      room_id: summary.room_id,
      servers,
    }));
    const getRoomSummary = vi.fn(async () => summary);
    const mx = { getRoomIdForAlias, getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let observedServers: string[] | undefined;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader roomIdOrAlias="#private:remote.example.org">
              {(_state, _retry, viaServers) => {
                observedServers = viaServers;
                return null;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(observedServers).toEqual(servers));
    });

    expect(getRoomIdForAlias).toHaveBeenCalledWith('#private:remote.example.org');
    expect(getRoomSummary).toHaveBeenCalledWith(summary.room_id, servers);
    act(() => renderer!.unmount());
    queryClient.clear();
  });

  it('preserves a verified alias target when summary discovery fails', async () => {
    const servers = ['one.example.org', 'two.example.org'];
    const getRoomIdForAlias = vi.fn(async () => ({
      room_id: summary.room_id,
      servers,
    }));
    const getRoomSummary = vi.fn(async () => {
      throw new Error('Summary unavailable');
    });
    const mx = { getRoomIdForAlias, getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let observedStatus: AsyncStatus | undefined;
    let observedRoomId: string | undefined;
    let observedServers: string[] | undefined;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader roomIdOrAlias="#private:remote.example.org">
              {(state, _retry, viaServers, roomId) => {
                observedStatus = state.status;
                observedRoomId = roomId;
                observedServers = viaServers;
                return null;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(observedStatus).toBe(AsyncStatus.Error));
    });

    expect(observedRoomId).toBe(summary.room_id);
    expect(observedServers).toEqual(servers);
    act(() => renderer!.unmount());
    queryClient.clear();
  });

  describe('servers the room directory named', () => {
    /** Loads the summary and gives the servers the loader hands to its children. */
    const load = async (mx: MatrixClient, roomIdOrAlias: string, viaServers?: string[]) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let observedStatus: AsyncStatus | undefined;
      let observedServers: string[] | undefined;
      let renderer: ReactTestRenderer;

      await act(async () => {
        renderer = create(
          <QueryClientProvider client={queryClient}>
            <MatrixClientProvider value={mx}>
              <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias} viaServers={viaServers}>
                {(state, _retry, servers) => {
                  observedStatus = state.status;
                  observedServers = servers;
                  return null;
                }}
              </RoomSummaryLoader>
            </MatrixClientProvider>
          </QueryClientProvider>
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(observedStatus).toBe(AsyncStatus.Success));
      });
      act(() => renderer!.unmount());
      queryClient.clear();
      return observedServers;
    };

    it('asks for a room ID through the servers an earlier lookup of its alias gave', async () => {
      const getRoomSummary = vi.fn(async () => summary);
      const mx = { getRoomSummary } as unknown as MatrixClient;
      rememberDirectoryViaServers(mx, summary.room_id, ['one.example.org', 'two.example.org']);

      const servers = await load(mx, summary.room_id);

      expect(getRoomSummary.mock.calls).toEqual([
        [summary.room_id, ['one.example.org', 'two.example.org']],
      ]);
      expect(servers).toEqual(['one.example.org', 'two.example.org']);
    });

    it('asks for a room ID through the first five servers of a lookup that named 500', async () => {
      const named = Array.from({ length: 500 }, (_, index) => `s${index}.example.org`);
      const getRoomSummary = vi.fn(async () => summary);
      const mx = { getRoomSummary } as unknown as MatrixClient;
      rememberDirectoryViaServers(mx, summary.room_id, named);

      const servers = await load(mx, summary.room_id);

      expect(getRoomSummary.mock.calls).toEqual([[summary.room_id, named.slice(0, 5)]]);
      expect(servers).toEqual(named.slice(0, 5));
    });

    it('asks through the servers the caller names, whatever the directory gave', async () => {
      const getRoomSummary = vi.fn(async () => summary);
      const mx = { getRoomSummary } as unknown as MatrixClient;
      rememberDirectoryViaServers(mx, summary.room_id, ['one.example.org']);

      const servers = await load(mx, summary.room_id, ['named.example.org']);

      expect(getRoomSummary.mock.calls).toEqual([[summary.room_id, ['named.example.org']]]);
      expect(servers).toEqual(['named.example.org']);
    });

    it('asks through no servers for a room ID the directory was never asked about', async () => {
      const getRoomSummary = vi.fn(async () => summary);
      const mx = { getRoomSummary } as unknown as MatrixClient;
      rememberDirectoryViaServers(mx, '!other:remote.example.org', ['one.example.org']);

      const servers = await load(mx, summary.room_id, []);

      expect(getRoomSummary.mock.calls).toEqual([[summary.room_id, undefined]]);
      expect(servers).toBeUndefined();
    });

    it('asks through every server a fresh lookup of an alias names, and keeps none', async () => {
      const named = Array.from({ length: 12 }, (_, index) => `s${index}.example.org`);
      const getRoomIdForAlias = vi.fn(async () => ({ room_id: summary.room_id, servers: named }));
      const getRoomSummary = vi.fn(async (_roomId: string, _via?: string[]) => summary);
      const mx = { getRoomIdForAlias, getRoomSummary } as unknown as MatrixClient;

      const servers = await load(mx, '#private:remote.example.org');

      // The directory's own list, the very one: nothing cuts or copies it.
      expect(getRoomSummary.mock.calls).toEqual([[summary.room_id, named]]);
      expect(getRoomSummary.mock.calls[0]?.[1]).toBe(named);
      expect(servers).toBe(named);
      expect(getDirectoryViaServers(mx, summary.room_id)).toBeUndefined();
    });
  });

  it('reports a failed discovery instead of exposing an unknown access rule', async () => {
    const getRoomSummary = vi.fn(async () => {
      throw new Error('Summary unavailable');
    });
    const mx = { getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let observedStatus: AsyncStatus | undefined;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader roomIdOrAlias="!private:remote.example.org">
              {(state) => {
                observedStatus = state.status;
                return null;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(observedStatus).toBe(AsyncStatus.Error));
    });

    expect(observedStatus).toBe(AsyncStatus.Error);
    act(() => renderer!.unmount());
    queryClient.clear();
  });

  describe('a homeserver without the summary route the SDK asks', () => {
    const STABLE = `/_matrix/client/v1/room_summary/${summary.room_id}`;
    const MSC3266 = `/_matrix/client/unstable/im.nheko.summary/summary/${summary.room_id}`;
    const OLDEST = `/_matrix/client/unstable/im.nheko.summary/rooms/${summary.room_id}/summary`;
    const via = ['one.example.org', 'two.example.org'];
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    /**
     * Loads the summary from a homeserver that answers the paths in `routes` and knows no other.
     * `advertised` is whether its `/versions` names MSC3266, for which the SDK asks the stable
     * route; without it the SDK asks the MSC's own.
     */
    const summaryFrom = async (routes: Record<string, Response>, advertised: boolean) => {
      const requests: URL[] = [];
      const mx = createClient({
        baseUrl: 'https://example.org',
        accessToken: 'token',
        fetchFn: async (input) => {
          const url = new URL(String(input));
          const path = decodeURIComponent(url.pathname);
          if (path.endsWith('/versions')) {
            return json({
              versions: ['v1.11'],
              unstable_features: { 'org.matrix.msc3266': advertised },
            });
          }
          requests.push(url);
          return (
            routes[path]?.clone() ??
            json({ errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' }, 404)
          );
        },
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let observed: RoomSummaryState | undefined;
      let renderer: ReactTestRenderer;

      await act(async () => {
        renderer = create(
          <QueryClientProvider client={queryClient}>
            <MatrixClientProvider value={mx}>
              <RoomSummaryLoader roomIdOrAlias={summary.room_id} viaServers={via}>
                {(state) => {
                  observed = state;
                  return null;
                }}
              </RoomSummaryLoader>
            </MatrixClientProvider>
          </QueryClientProvider>
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(observed?.status).not.toBe(AsyncStatus.Loading));
      });
      act(() => renderer!.unmount());
      queryClient.clear();
      return {
        observed,
        asked: requests.map((url) => decodeURIComponent(url.pathname)),
        // The servers to ask over federation, as each request named them.
        vias: requests.map((url) => url.searchParams.getAll('via')),
      };
    };

    it("asks the MSC's route when the stable one the homeserver advertises is missing", async () => {
      const { observed, asked, vias } = await summaryFrom({ [MSC3266]: json(summary) }, true);

      expect(observed).toEqual({ status: AsyncStatus.Success, data: summary });
      expect(asked).toEqual([STABLE, MSC3266]);
      expect(vias).toEqual([via, via]);
    });

    it("asks the MSC's route when a proxy answers the stable one with a bare 404", async () => {
      const notFoundPage = new Response('<html><body>404 Not Found</body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      });
      const { observed, asked, vias } = await summaryFrom(
        { [STABLE]: notFoundPage, [MSC3266]: json(summary) },
        true
      );

      expect(observed).toEqual({ status: AsyncStatus.Success, data: summary });
      expect(asked).toEqual([STABLE, MSC3266]);
      expect(vias).toEqual([via, via]);
    });

    it('reports a room the stable route does not find, and asks no older route', async () => {
      const { observed, asked } = await summaryFrom(
        { [STABLE]: json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404) },
        true
      );

      expect(observed).toMatchObject({
        status: AsyncStatus.Error,
        error: { errcode: 'M_NOT_FOUND', httpStatus: 404 },
      });
      expect(asked).toEqual([STABLE]);
    });

    it('asks the route of the first MSC3266 servers last', async () => {
      const { observed, asked, vias } = await summaryFrom({ [OLDEST]: json(summary) }, true);

      expect(observed).toEqual({ status: AsyncStatus.Success, data: summary });
      expect(asked).toEqual([STABLE, MSC3266, OLDEST]);
      expect(vias).toEqual([via, via, via]);
    });

    it("does not ask the MSC's route again when the SDK asked it", async () => {
      const { observed, asked, vias } = await summaryFrom({ [OLDEST]: json(summary) }, false);

      expect(observed).toEqual({ status: AsyncStatus.Success, data: summary });
      expect(asked).toEqual([MSC3266, OLDEST]);
      expect(vias).toEqual([via, via]);
    });

    it('reports a refusal of an older route, and asks no further one', async () => {
      const { observed, asked } = await summaryFrom(
        { [MSC3266]: json({ errcode: 'M_FORBIDDEN', error: 'Not allowed' }, 403) },
        true
      );

      expect(observed).toMatchObject({
        status: AsyncStatus.Error,
        error: { errcode: 'M_FORBIDDEN', httpStatus: 403 },
      });
      expect(asked).toEqual([STABLE, MSC3266]);
    });

    it('reports a server error of the route the SDK asks, and asks no older one', async () => {
      const { observed, asked } = await summaryFrom(
        { [STABLE]: json({ errcode: 'M_UNKNOWN', error: 'Internal server error' }, 500) },
        true
      );

      expect(observed).toMatchObject({
        status: AsyncStatus.Error,
        error: { errcode: 'M_UNKNOWN', httpStatus: 500 },
      });
      expect(asked).toEqual([STABLE]);
    });
  });
});
