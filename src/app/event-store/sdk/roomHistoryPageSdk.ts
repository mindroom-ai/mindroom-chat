import {
  Direction,
  THREAD_RELATION_TYPE,
  type EventTimeline,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { noUnsafeEventProps } from 'matrix-js-sdk/lib/utils';
import { keepHistoryReplies } from '../timeline/classicHistoryReplies';

/**
 * One page of the room's own history at `edge`, loaded as `MatrixClient.paginateEventTimeline`
 * loads it, with one difference: the page's thread replies, which the SDK drops, are kept with
 * `edge` for the Classic view, and decrypted in an encrypted room. Resolves to whether more history
 * lies that way.
 */
export const paginateRoomKeepingReplies = (
  mx: MatrixClient,
  room: Room,
  edge: EventTimeline,
  backwards: boolean,
  limit: number
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
      edge.getTimelineSet().addEventsToTimeline(roomEvents, backwards, false, edge, response.end);
      mx.processAggregatedTimelineEvents(room, roomEvents);
      mx.processThreadRoots(
        room,
        roomEvents.filter((event) => event.getServerAggregatedRelation(THREAD_RELATION_TYPE.name)),
        false
      );
      unknownRelations.forEach((event) => room.relations.aggregateChildEvent(event));
      if (room.hasEncryptionStateEvent()) {
        await Promise.all(
          threadedEvents.map((event) => mx.decryptEventIfNeeded(event).catch(() => undefined))
        );
      }
      keepHistoryReplies(room, edge, threadedEvents);
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
