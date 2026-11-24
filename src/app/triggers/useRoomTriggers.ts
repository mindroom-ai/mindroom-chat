import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MatrixEventEvent,
  RoomEvent,
  type IRoomTimelineData,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { useRoomMindroomServer } from '../computer/useRoomMindroomServer';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { readTriggerWake } from '../matrix/protocol/triggerWake';
import {
  RoomTriggerMutationError,
  deleteRoomTrigger,
  fetchRoomTriggers,
  setRoomTriggerEnabled,
  type RoomTrigger,
} from './roomTriggersApi';

const EMPTY_TRIGGERS: readonly RoomTrigger[] = [];
const CACHE_GC_MS = 10 * 60_000;

export const roomTriggersQueryKey = (apiUrl: string | undefined, roomId: string) =>
  ['room-triggers', apiUrl ?? '', roomId] as const;

const isTriggerWakeEvent = (event: MatrixEvent, viewerUserId: string | undefined): boolean =>
  event.getType() === 'm.room.message' &&
  isMindroomAgentUserIdForViewer(event.getSender(), viewerUserId) &&
  readTriggerWake(event.getContent()) !== null;

export type RoomTriggersHandle = {
  triggers: readonly RoomTrigger[];
  isFetching: boolean;
  refetch: () => Promise<void>;
  toggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  deleteTrigger: (triggerId: string) => Promise<void>;
};

/**
 * Fetches and caches a room's triggers per room via React Query, refetches on live trigger-wake
 * messages in the room, and exposes refetch plus owner enable/disable and delete mutations.
 */
export function useRoomTriggers(room: Room): RoomTriggersHandle {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const { apiUrl, pending } = useRoomMindroomServer(mx, room.roomId);
  const joined = room.getMyMembership() === 'join';
  const enabled = Boolean(joined && !pending && apiUrl);
  const queryKey = roomTriggersQueryKey(apiUrl, room.roomId);

  const query = useQuery({
    queryKey,
    enabled,
    retry: false,
    gcTime: CACHE_GC_MS,
    queryFn: ({ signal }) => fetchRoomTriggers(mx, apiUrl!, room.roomId, signal),
  });

  const refetch = useCallback(async () => {
    if (!enabled || !apiUrl) return;
    await queryClient.invalidateQueries({ queryKey: roomTriggersQueryKey(apiUrl, room.roomId) });
  }, [apiUrl, enabled, queryClient, room.roomId]);

  useEffect(() => {
    if (!enabled || !apiUrl) return undefined;
    const viewerUserId = mx.getUserId() ?? undefined;
    const pendingEncrypted = new Set<MatrixEvent>();
    const onWake = () =>
      void queryClient.invalidateQueries({ queryKey: roomTriggersQueryKey(apiUrl, room.roomId) });

    const onTimeline = (
      event: MatrixEvent,
      eventRoom: Room | undefined,
      toStart: boolean | undefined,
      removed: boolean,
      data: IRoomTimelineData
    ) => {
      if (removed || toStart || !data.liveEvent) return;
      if ((eventRoom?.roomId ?? event.getRoomId()) !== room.roomId) return;
      if (event.isEncrypted() && event.getType() === 'm.room.encrypted') {
        pendingEncrypted.add(event);
        return;
      }
      if (isTriggerWakeEvent(event, viewerUserId)) onWake();
    };

    const onDecrypted = (event: MatrixEvent) => {
      if (pendingEncrypted.delete(event) && isTriggerWakeEvent(event, viewerUserId)) onWake();
    };

    mx.on(RoomEvent.Timeline, onTimeline);
    mx.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      pendingEncrypted.clear();
      mx.removeListener(RoomEvent.Timeline, onTimeline);
      mx.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [apiUrl, enabled, mx, queryClient, room.roomId]);

  const mutate = useCallback(
    async (
      run: (url: string) => Promise<(prev: RoomTrigger[] | undefined) => RoomTrigger[] | undefined>
    ) => {
      if (!apiUrl) throw new Error('No MindRoom server available for this room.');
      const key = roomTriggersQueryKey(apiUrl, room.roomId);
      try {
        const update = await run(apiUrl);
        queryClient.setQueryData<RoomTrigger[]>(key, update);
        await queryClient.invalidateQueries({ queryKey: key });
      } catch (error) {
        if (error instanceof RoomTriggerMutationError && error.status === 404) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        throw error;
      }
    },
    [apiUrl, queryClient, room.roomId]
  );

  const toggleTrigger = useCallback(
    (triggerId: string, nextEnabled: boolean) =>
      mutate(async (url) => {
        const updated = await setRoomTriggerEnabled(mx, url, room.roomId, triggerId, nextEnabled);
        return (prev) =>
          updated
            ? prev?.map((row) => (row.triggerId === updated.triggerId ? updated : row))
            : prev;
      }),
    [mutate, mx, room.roomId]
  );

  const deleteTrigger = useCallback(
    (triggerId: string) =>
      mutate(async (url) => {
        await deleteRoomTrigger(mx, url, room.roomId, triggerId);
        return (prev) => prev?.filter((row) => row.triggerId !== triggerId);
      }),
    [mutate, mx, room.roomId]
  );

  return {
    triggers: enabled ? (query.data ?? EMPTY_TRIGGERS) : EMPTY_TRIGGERS,
    isFetching: joined && (pending || (enabled && query.isFetching)),
    refetch,
    toggleTrigger,
    deleteTrigger,
  };
}
