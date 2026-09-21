import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useFetchRoomEvent } from './useRoomEvent';
import { usePinnedEventIds } from './useThreadPinning';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';

const collectEvents = (results: UseQueryResult<MatrixEvent>[]) =>
  results.map((result) => result.data);

/** Pins can outlive the loaded room timeline, including roots with no replies. */
export const usePinnedThreadEvents = (
  room: Room,
  enabled: boolean,
  revision = 0
): MatrixEvent[] => {
  const pinnedEventIds = usePinnedEventIds(room);
  const fetchEvent = useFetchRoomEvent(room);
  const fetched = useQueries({
    queries: pinnedEventIds.map((eventId) => ({
      queryKey: [room.roomId, eventId, undefined],
      queryFn: () => fetchEvent(eventId),
      enabled: enabled && !room.findEventById(eventId),
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      retry: (failureCount: number, error: unknown) =>
        (error as { errcode?: string })?.errcode !== 'M_NOT_FOUND' && failureCount < 3,
    })),
    combine: collectEvents,
  });
  return useMemo(() => {
    // SDK rooms retain their identity when newer live events replace cached copies.
    void revision;
    return enabled
      ? pinnedEventIds
          .map((id, index) => room.findEventById(id) ?? fetched[index])
          .filter(
            (event): event is MatrixEvent => !!event && isZeroReplyStandaloneThreadRootEvent(event)
          )
      : [];
  }, [enabled, pinnedEventIds, room, fetched, revision]);
};
