import { useMemo } from 'react';
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

const ROOM_TRIGGERS_QUERY_KEY = 'room-triggers';
const roomTriggersQueryKey = (roomId: string, apiUrl: string) =>
  [ROOM_TRIGGERS_QUERY_KEY, roomId, apiUrl] as const;
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

  const mutate = async (fn: (url: string) => Promise<void>) => {
    if (!apiUrl) throw new Error('No MindRoom server available for this room.');
    await fn(apiUrl);
    await queryClient.invalidateQueries({ queryKey });
  };

  const toggleTrigger = (triggerId: string, nextEnabled: boolean) =>
    mutate((url) => setRoomTriggerEnabled(mx, url, room.roomId, triggerId, nextEnabled));

  const deleteTrigger = (triggerId: string) =>
    mutate((url) => deleteRoomTrigger(mx, url, room.roomId, triggerId));

  const loaded = enabled && Array.isArray(query.data);
  const loading = joined && (pending || (enabled && query.isFetching));
  const failed = enabled && query.isError;
  return {
    triggers: loaded ? query.data! : EMPTY,
    loading,
    loadFailed: loaded ? failed : !loading,
    refetch: query.refetch,
    toggleTrigger,
    deleteTrigger,
  };
}
