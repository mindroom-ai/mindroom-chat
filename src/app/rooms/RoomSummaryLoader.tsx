import { ReactNode, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type MatrixClient, type Room, type RoomSummary, SyncState } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { AsyncState, AsyncStatus } from '../lib/hooks/useAsyncCallback';
import { type LocalRoomSummary, useLocalRoomSummary } from './useLocalRoomSummary';
import { isRoomAlias } from '../matrix/matrix';
import { useSyncState } from '../matrix/hooks/useSyncState';

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

/**
 * Loads a room's summary (MSC3266) for a room the user may not have joined. An alias resolves to
 * a room ID first; its routing servers are used when the caller passed none. The resolved ID and
 * servers stay available when the summary itself fails, and a failed summary is requested again
 * when the client's sync recovers.
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

  const summaryQuery = useQuery({
    queryKey: ['room-summary', roomIdOrAlias, viaServers],
    // A failed summary is a result the card shows (with its own retry), not a request to repeat.
    retry: false,
    queryFn: async () => {
      let roomId = roomIdOrAlias;
      let servers = viaServers;
      if (alias) {
        const resolved = await queryClient.fetchQuery({
          queryKey: aliasQueryKey(alias),
          queryFn: resolveAlias(mx, alias),
          staleTime: Infinity,
        });
        roomId = resolved.room_id;
        if (!servers || servers.length === 0) servers = resolved.servers;
      }
      return mx.getRoomSummary(roomId, servers);
    },
  });

  const roomId = alias ? resolvedAlias?.room_id : roomIdOrAlias;
  const servers = viaServers && viaServers.length > 0 ? viaServers : resolvedAlias?.servers;

  const { refetch } = summaryQuery;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  // A summary that failed while the homeserver was out of reach is asked again once sync is back.
  const failedRef = useRef(false);
  failedRef.current = summaryQuery.isError;
  useSyncState(
    mx,
    useCallback(
      (syncState: SyncState, previous: SyncState | null) => {
        const reconnected =
          syncState === SyncState.Prepared ||
          (syncState === SyncState.Syncing && previous !== SyncState.Syncing);
        if (reconnected && failedRef.current) void refetch();
      },
      [refetch]
    )
  );

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
