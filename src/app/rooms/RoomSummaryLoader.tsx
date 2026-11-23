import { ReactNode, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HTTPError,
  MatrixError,
  Method,
  type MatrixClient,
  type Room,
  type RoomSummary,
} from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { AsyncState, AsyncStatus } from '../lib/hooks/useAsyncCallback';
import { type LocalRoomSummary, useLocalRoomSummary } from './useLocalRoomSummary';
import { isRoomAlias } from '../matrix/matrix';
import { getDirectoryViaServers } from '../matrix/directoryViaServers';

export type RoomSummaryState = AsyncState<RoomSummary, unknown>;

type RoomSummaryLoaderProps = {
  roomIdOrAlias: string;
  /** Servers to ask over federation; an alias brings its own when this is empty. */
  viaServers?: string[];
  children: (
    state: RoomSummaryState,
    retry: () => void,
    /** The servers the summary was requested through. */
    viaServers?: string[],
    /** The room ID, once an alias resolved to one. */
    roomId?: string
  ) => ReactNode;
};

const aliasQueryKey = (alias: string | undefined) => ['room-alias', alias] as const;

const resolveAlias = (mx: MatrixClient, alias: string) => () => mx.getRoomIdForAlias(alias);

const MSC3266_PREFIX = '/_matrix/client/unstable/im.nheko.summary';

/**
 * Whether the homeserver does not have the route: `M_UNRECOGNIZED`, or a 404 without a Matrix error
 * code, which is what a proxy answers. A 404 with another code, such as `M_NOT_FOUND` for the room,
 * is the route's answer.
 */
const isUnknownRoute = (error: unknown): boolean => {
  if (error instanceof MatrixError && error.errcode) return error.errcode === 'M_UNRECOGNIZED';
  return error instanceof HTTPError && error.httpStatus === 404;
};

/**
 * Whether the SDK asks the stable summary route of this homeserver: for Matrix 1.15, or MSC3266
 * among the unstable features (its `room-summary-api.ts`). Otherwise it asks the MSC's own route.
 */
const sdkAsksStableRoute = async (mx: MatrixClient): Promise<boolean> => {
  const { versions, unstable_features: unstableFeatures } = await mx.getVersions();
  return versions.includes('v1.15') || !!unstableFeatures?.['org.matrix.msc3266'];
};

/**
 * The summary from the one route the SDK asks or, when the homeserver does not know that route,
 * from the older ones matrix-js-sdk asked itself until 45.0: the MSC's `summary/{roomId}` (unless
 * that is the one the SDK asked), then the `rooms/{roomId}/summary` of the first MSC3266 servers.
 * Any failure but an unknown route ({@link isUnknownRoute}) is the result.
 */
const fetchRoomSummary = async (
  mx: MatrixClient,
  roomId: string,
  via: string[] | undefined
): Promise<RoomSummary> => {
  try {
    return await mx.getRoomSummary(roomId, via);
  } catch (error) {
    if (!isUnknownRoute(error)) throw error;
  }
  const request = (path: string) =>
    mx.http.authedRequest<RoomSummary>(Method.Get, path, { via }, undefined, {
      prefix: MSC3266_PREFIX,
    });
  const room = encodeURIComponent(roomId);
  if (await sdkAsksStableRoute(mx)) {
    try {
      return await request(`/summary/${room}`);
    } catch (error) {
      if (!isUnknownRoute(error)) throw error;
    }
  }
  return request(`/rooms/${room}/summary`);
};

/**
 * Loads a room's summary (MSC3266) for a room the user may not have joined. An alias resolves to
 * a room ID first; its routing servers are used when the caller passed none, as are the servers
 * an earlier directory lookup gave for a room ID. The resolved ID and servers stay available when
 * the summary itself fails.
 */
export function RoomSummaryLoader({ roomIdOrAlias, viaServers, children }: RoomSummaryLoaderProps) {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const alias = isRoomAlias(roomIdOrAlias) ? roomIdOrAlias : undefined;

  // Reads the alias resolution the summary request stores; it never fetches on its own.
  const { data: resolvedAlias } = useQuery({
    queryKey: aliasQueryKey(alias),
    queryFn: resolveAlias(mx, alias ?? ''),
    enabled: false,
    staleTime: Infinity,
  });

  // The caller's servers, else for a room ID the ones the directory gave when an alias resolved
  // to it. An alias brings its own with the summary request.
  const given = viaServers && viaServers.length > 0 ? viaServers : undefined;
  const known = given ?? (alias ? undefined : getDirectoryViaServers(mx, roomIdOrAlias));

  const summaryQuery = useQuery({
    queryKey: ['room-summary', roomIdOrAlias, known],
    // A failed summary is a result the card shows (with its own retry), not a request to repeat.
    retry: false,
    queryFn: async () => {
      let roomId = roomIdOrAlias;
      let servers = known;
      if (alias) {
        const resolved = await queryClient.fetchQuery({
          queryKey: aliasQueryKey(alias),
          queryFn: resolveAlias(mx, alias),
          staleTime: Infinity,
        });
        roomId = resolved.room_id;
        servers ??= resolved.servers;
      }
      return fetchRoomSummary(mx, roomId, servers);
    },
  });

  const roomId = alias ? resolvedAlias?.room_id : roomIdOrAlias;
  const servers = known ?? resolvedAlias?.servers;

  const { refetch } = summaryQuery;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  let state: RoomSummaryState;
  if (summaryQuery.isError) {
    state = { status: AsyncStatus.Error, error: summaryQuery.error };
  } else if (summaryQuery.isSuccess) {
    state = { status: AsyncStatus.Success, data: summaryQuery.data };
  } else {
    state = { status: AsyncStatus.Loading };
  }

  return children(state, retry, servers, roomId);
}

type LocalRoomSummaryLoaderProps = {
  room: Room;
  children: (summary: LocalRoomSummary) => ReactNode;
};

/** The summary of a room the client already has, from its synced state; follows changes. */
export function LocalRoomSummaryLoader({ room, children }: LocalRoomSummaryLoaderProps) {
  const summary = useLocalRoomSummary(room);
  return children(summary);
}
