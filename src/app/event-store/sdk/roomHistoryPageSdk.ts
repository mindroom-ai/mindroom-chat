import {
  Direction,
  THREAD_RELATION_TYPE,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { noUnsafeEventProps } from 'matrix-js-sdk/lib/utils';
import { holdPageThreadEvents, keepHistoryReplies } from '../timeline/classicHistoryReplies';

/**
 * The events of a page the room's timeline takes, in the order it adds them, and the others.
 * Partitioning places a redaction, an edit or a reaction of an older event of the same page where
 * that event lives, in the room. But the timeline checks each event as it adds it, and a page read
 * backwards adds the newest first, before the older event is in it: it finds no parent, refuses the
 * event and warns ("cannot be added to any timeline"; an agent's room warned for every stop
 * reaction its agents had removed). The others are kept as relations, as the timeline kept them
 * before it refused them.
 */
export const splitTimelinePage = (
  room: Room,
  events: MatrixEvent[]
): [taken: MatrixEvent[], others: MatrixEvent[]] => {
  const taken: MatrixEvent[] = [];
  const others: MatrixEvent[] = [];
  events.forEach((event) => {
    // The timeline then holds the room's events and the ones of the page added before this one.
    const { shouldLiveInRoom, shouldLiveInThread } = room.eventShouldLiveIn(event, taken);
    (shouldLiveInRoom || shouldLiveInThread ? taken : others).push(event);
  });
  return [taken, others];
};

/**
 * One page of the room's own history at `edge`, loaded as `MatrixClient.paginateEventTimeline`
 * loads it, with two differences: events the timeline would refuse are kept as relations only
 * (`splitTimelinePage`), and with `keepReplies` (the Classic view) the page's thread replies,
 * which the SDK drops, are kept with `edge`, and decrypted in an encrypted room; they wait there
 * for the cache (`takePageThreadEvents`). Resolves to whether more history lies that way.
 */
export const paginateRoomHistory = (
  mx: MatrixClient,
  room: Room,
  edge: EventTimeline,
  backwards: boolean,
  limit: number,
  keepReplies: boolean
): Promise<boolean> => {
  const dir = backwards ? Direction.Backward : Direction.Forward;
  const pending = edge.paginationRequests[dir];
  if (pending) return pending;
  const request = mx
    .createMessagesRequest(room.roomId, edge.getPaginationToken(dir), limit, dir, edge.getFilter())
    .then(async (response) => {
      const mapper = mx.getEventMapper();
      if (response.state) {
        edge
          .getState(dir)
          ?.setUnknownStateEvents(response.state.filter(noUnsafeEventProps).map(mapper));
      }
      const events = response.chunk.filter(noUnsafeEventProps).map(mapper);
      const [roomEvents, threadedEvents, unknownRelations] = room.partitionThreadedEvents(events);
      const [placed, relations] = splitTimelinePage(room, roomEvents);
      edge.getTimelineSet().addEventsToTimeline(placed, backwards, false, edge, response.end);
      mx.processAggregatedTimelineEvents(room, roomEvents);
      mx.processThreadRoots(
        room,
        roomEvents.filter((event) => event.getServerAggregatedRelation(THREAD_RELATION_TYPE.name)),
        false
      );
      [...unknownRelations, ...relations].forEach((event) =>
        room.relations.aggregateChildEvent(event)
      );
      if (keepReplies) {
        if (room.hasEncryptionStateEvent()) {
          await Promise.all(
            threadedEvents.map((event) => mx.decryptEventIfNeeded(event).catch(() => undefined))
          );
        }
        const kept = keepHistoryReplies(room, edge, threadedEvents);
        holdPageThreadEvents(room, edge, threadedEvents, kept);
      }
      const atEnd = response.end === undefined || response.end === response.start;
      // The forward token stays, so a gappy sync can still be filled.
      if (backwards && atEnd) edge.setPaginationToken(null, dir);
      return !atEnd;
    })
    .finally(() => {
      edge.paginationRequests[dir] = null;
    });
  edge.paginationRequests[dir] = request;
  return request;
};
