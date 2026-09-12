import { Direction, EventType, MatrixClient, MatrixEvent, RelationType } from 'matrix-js-sdk';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';
import { createPreferLiveEventMapper } from '../threads/eventRepository';
import { BackfillScheduler } from './backfillScheduler';

export const enqueueThreadApprovalBackfill = (
  mx: MatrixClient,
  scheduler: BackfillScheduler,
  roomId: string,
  threadId: string,
  repairOrigins?: readonly MatrixEvent[]
): Promise<{ events: MatrixEvent[]; repairedEventIds: string[]; error?: string }> =>
  scheduler.enqueue({
    roomId,
    threadId,
    kind: 'thread-approvals',
    priority: 0,
    execute: async (signal) => {
      const collected: MatrixEvent[] = [];
      const repairedEventIds: string[] = [];
      const room = mx.getRoom(roomId);
      if (!room) return { events: collected, repairedEventIds };
      const mapEvent = createPreferLiveEventMapper(room, mx.getEventMapper({ decrypt: false }));
      const eventType = room.hasEncryptionStateEvent() ? null : MINDROOM_TOOL_APPROVAL_EVENT;
      const fetchPages = async (target: string, relation: RelationType): Promise<MatrixEvent[]> => {
        const events: MatrixEvent[] = [];
        let from: string | undefined;
        const seen = new Set<string>();
        do {
          if (signal.aborted) return events;
          const page = await mx.fetchRelations(roomId, target, relation, eventType, {
            dir: Direction.Backward,
            limit: 100,
            ...(from ? { from } : {}),
          });
          if (signal.aborted) return events;
          const mapped = page.chunk.map((raw) => mapEvent({ ...raw, room_id: roomId }));
          await Promise.all(mapped.map((event) => mx.decryptEventIfNeeded(event)));
          if (signal.aborted) return events;
          // Keep unavailable ciphertext: the provider owns late-key subscriptions.
          const relevant = mapped.filter(
            (event) =>
              event.getType() === MINDROOM_TOOL_APPROVAL_EVENT ||
              event.getType() === EventType.RoomMessageEncrypted
          );
          collected.push(...relevant);
          events.push(...relevant);
          from = page.next_batch ?? undefined;
          if (from && seen.has(from))
            throw new Error('Approval history pagination did not advance');
          if (from) seen.add(from);
        } while (from);
        return events;
      };
      try {
        const origins = repairOrigins ?? (await fetchPages(threadId, RelationType.Thread));
        for (const event of origins) {
          if (signal.aborted) break;
          if (event.getType() !== MINDROOM_TOOL_APPROVAL_EVENT) continue;
          const id = event.getId();
          const content = event.getOriginalContent();
          if (id && (content.status === 'pending' || content.auto_approval))
            await fetchPages(id, RelationType.Replace);
          if (id) repairedEventIds.push(id);
        }
        return { events: collected, repairedEventIds };
      } catch {
        return {
          events: collected,
          repairedEventIds,
          error: 'Some approval history could not be loaded.',
        };
      }
    },
  });
