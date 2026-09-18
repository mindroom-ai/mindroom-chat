import { RelationType, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { createPreferLiveEventMapper } from '../threads/eventRepository';
import { hydrateCachedEvents } from '../threads/eventCacheEditUtils';
import type { BackfillScheduler } from './backfillScheduler';
import type { EnginePersistFacade } from './enginePersistFacade';

/** Recover explicit reply references without draining the thread's history again. */
export const enqueueThreadResponseBackfill = (
  mx: MatrixClient,
  scheduler: BackfillScheduler,
  roomId: string,
  threadId: string,
  responseIds: readonly string[],
  persist: EnginePersistFacade['persistThreadEventCache']
): Promise<{ events: MatrixEvent[]; attemptedIds: string[] }> =>
  scheduler.enqueue({
    roomId,
    threadId,
    kind: 'thread-responses',
    priority: 0,
    execute: async (signal) => {
      const events: MatrixEvent[] = [];
      const attemptedIds: string[] = [];
      const room = mx.getRoom(roomId);
      if (!room) return { events, attemptedIds };
      const mapEvent = createPreferLiveEventMapper(room, mx.getEventMapper({ decrypt: false }));
      // Yield the scheduler between small batches; one old reply may be missing
      // behind several receipts, so deduplicate before making any requests.
      for (const id of [...new Set(responseIds)].slice(0, 20)) {
        if (signal.aborted) break;
        attemptedIds.push(id);
        try {
          const raw = await mx.fetchRoomEvent(roomId, id);
          if (signal.aborted) break;
          if (raw.event_id !== id || (raw.room_id && raw.room_id !== roomId)) continue;
          const event = mapEvent({ ...raw, room_id: roomId });
          await mx.decryptEventIfNeeded(event);
          if (signal.aborted) break;
          // Replacements may omit the thread relation from m.new_content.
          const relation = event.getRelation();
          if (
            event.isRedacted() ||
            event.getType() !== 'm.room.message' ||
            relation?.rel_type !== RelationType.Thread ||
            relation.event_id !== threadId
          )
            continue;
          events.push(event);
        } catch {
          // A failed/missing event must not block the remaining references.
          // The open thread retries failures on resume or its next visit.
        }
      }
      if (signal.aborted) return { events: [], attemptedIds };
      if (events.length > 0) {
        hydrateCachedEvents({ room, events });
        persist(room, threadId, events, room.getThread(threadId)?.rootEvent);
        room.getThread(threadId)?.addEvents(events, false);
      }
      return { events, attemptedIds };
    },
  });
