import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Room } from 'matrix-js-sdk';
import { useRoomMindroomServer } from '../computer/useRoomMindroomServer';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
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
    () => ['room-triggers', apiUrl ?? '', room.roomId] as const,
    [apiUrl, room.roomId]
  );

  const query = useQuery({
    queryKey,
    enabled,
    retry: false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    queryFn: ({ signal }) => fetchRoomTriggers(mx, apiUrl!, room.roomId, signal),
  });

  const refetch = useCallback(async () => {
    if (enabled) await queryClient.invalidateQueries({ queryKey });
  }, [enabled, queryClient, queryKey]);

  const apply = async (updater: (prev: RoomTrigger[] | undefined) => RoomTrigger[] | undefined) => {
    queryClient.setQueryData<RoomTrigger[]>(queryKey, updater);
    await queryClient.invalidateQueries({ queryKey });
  };

  const toggleTrigger = async (triggerId: string, nextEnabled: boolean) => {
    if (!apiUrl) throw new Error('No MindRoom server available for this room.');
    const row = await setRoomTriggerEnabled(mx, apiUrl, room.roomId, triggerId, nextEnabled);
    await apply((prev) =>
      row ? prev?.map((r) => (r.triggerId === row.triggerId ? row : r)) : prev
    );
  };

  const deleteTrigger = async (triggerId: string) => {
    if (!apiUrl) throw new Error('No MindRoom server available for this room.');
    await deleteRoomTrigger(mx, apiUrl, room.roomId, triggerId);
    await apply((prev) => prev?.filter((r) => r.triggerId !== triggerId));
  };

  return {
    triggers: enabled ? (query.data ?? EMPTY) : EMPTY,
    isFetching: joined && (pending || (enabled && query.isFetching)),
    refetch,
    toggleTrigger,
    deleteTrigger,
  };
}
