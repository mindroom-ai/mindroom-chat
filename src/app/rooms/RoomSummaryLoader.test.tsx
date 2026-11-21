import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AsyncStatus } from '../lib/hooks/useAsyncCallback';
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
