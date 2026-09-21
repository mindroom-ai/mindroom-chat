import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { RelationType, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useFetchRoomEvent } from './useRoomEvent';
import { usePinnedEventIds } from './useThreadPinning';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { hydrateCachedEvents } from './eventCacheEditUtils';
import { useForceUpdate } from '../../hooks/useForceUpdate';

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
  const [relationVersion, refreshRelations] = useForceUpdate();
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
  useEffect(() => {
    if (!enabled) return undefined;
    const roots = pinnedEventIds
      .map((id, index) => room.findEventById(id) ?? fetched[index])
      .filter((event): event is MatrixEvent => !!event);
    if (roots.length === 0) return undefined;
    const reconcile = () => {
      const before = roots.map((root) => [root.isRedacted(), root.replacingEvent()?.getId()]);
      // Query-loaded roots need the same edit/redaction hydration as cached timeline events.
      const replacements = roots
        .map((event) => event.replacingEvent())
        .filter((event): event is MatrixEvent => !!event);
      const loaded = room
        .getUnfilteredTimelineSet()
        .getTimelines()
        .flatMap((timeline) => timeline.getEvents());
      const rootIds = new Set(roots.map((root) => root.getId()));
      const edits = loaded.filter(
        (event) =>
          event.getRelation()?.rel_type === RelationType.Replace &&
          rootIds.has(event.getRelation()?.event_id)
      );
      const targetIds = new Set([
        ...rootIds,
        ...replacements.map((event) => event.getId()),
        ...edits.map((event) => event.getId()),
      ]);
      const redactions = loaded.filter(
        (event) => event.isRedaction() && targetIds.has(event.getAssociatedId())
      );
      hydrateCachedEvents({
        room,
        events: [...roots, ...replacements, ...edits, ...redactions],
      });
      return roots.some(
        (root, index) =>
          root.isRedacted() !== before[index][0] ||
          root.replacingEvent()?.getId() !== before[index][1]
      );
    };
    const handleEvent = (event: MatrixEvent) => {
      const targetId = event.getAssociatedId();
      if (
        targetId &&
        roots.some(
          (root) => root.getId() === targetId || root.replacingEvent()?.getId() === targetId
        )
      ) {
        reconcile();
        refreshRelations();
      }
    };
    if (reconcile()) refreshRelations();
    room.on(RoomEvent.Timeline, handleEvent);
    room.on(RoomEvent.Redaction, handleEvent);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleEvent);
      room.removeListener(RoomEvent.Redaction, handleEvent);
    };
  }, [enabled, pinnedEventIds, room, fetched, revision, refreshRelations]);
  return useMemo(() => {
    // SDK rooms retain their identity when newer live events replace cached copies.
    void revision;
    void relationVersion;
    return enabled
      ? pinnedEventIds
          .map((id, index) => room.findEventById(id) ?? fetched[index])
          .filter(
            (event): event is MatrixEvent => !!event && isZeroReplyStandaloneThreadRootEvent(event)
          )
      : [];
  }, [enabled, pinnedEventIds, room, fetched, revision, relationVersion]);
};
