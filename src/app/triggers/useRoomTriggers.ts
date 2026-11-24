import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Room } from 'matrix-js-sdk';
import { useRoomMindroomServer } from '../computer/useRoomMindroomServer';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { roomTriggersQueryKey } from '../navigation/roomTriggersDialog';
import {
  deleteRoomTrigger,
  fetchRoomTriggers,
  setRoomTriggerEnabled,
  type RoomTrigger,
} from './roomTriggersApi';

const EMPTY: readonly RoomTrigger[] = [];

/** Fetches and caches a room's triggers per room, exposing refetch and owner mutations. */
export function useRoomTriggers(room: Room) {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const { apiUrl, pending } = useRoomMindroomServer(mx, room.roomId);
  const joined = room.getMyMembership() === 'join';
  const enabled = Boolean(joined && !pending && apiUrl);
  const queryKey = useMemo(
    () => roomTriggersQueryKey(room.roomId, apiUrl ?? ''),
    [room.roomId, apiUrl]
  );

  const query = useQuery({
    queryKey,
    enabled,
    retry: false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      joined && apiUrl ? fetchRoomTriggers(mx, apiUrl, room.roomId, signal) : null,
  });

  const apply = async (
    updater: (prev: RoomTrigger[] | null | undefined) => RoomTrigger[] | null | undefined
  ) => {
    queryClient.setQueryData<RoomTrigger[] | null>(queryKey, updater);
    await queryClient.invalidateQueries({ queryKey });
  };

  const toggleTrigger = async (triggerId: string, nextEnabled: boolean) => {
    if (!apiUrl) throw new Error('No MindRoom server available for this room.');
    const row = await setRoomTriggerEnabled(mx, apiUrl, room.roomId, triggerId, nextEnabled);
    await apply((prev) =>
      row && prev ? prev.map((r) => (r.triggerId === row.triggerId ? row : r)) : prev
    );
  };

  const deleteTrigger = async (triggerId: string) => {
    if (!apiUrl) throw new Error('No MindRoom server available for this room.');
    await deleteRoomTrigger(mx, apiUrl, room.roomId, triggerId);
    await apply((prev) => prev?.filter((r) => r.triggerId !== triggerId));
  };

  const loaded = enabled && Array.isArray(query.data);
  const loading = joined && (pending || (enabled && (query.isFetching || query.isPending)));
  return {
    triggers: loaded ? query.data! : EMPTY,
    loading,
    loadFailed: !loading && !loaded,
    refetch: query.refetch,
    toggleTrigger,
    deleteTrigger,
  };
}
