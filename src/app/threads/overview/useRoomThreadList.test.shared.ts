import { Direction, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { createSyncEngine } from '../../event-store/engine/syncEngine';

export const userId = '@alice:example.org';
export const roomId = '!offline:example.org';

class ListingClient extends MatrixClient {
  constructor(fetchFn?: typeof fetch) {
    super({ baseUrl: 'https://example.org', userId, fetchFn });
    this.clientOpts = { threadSupport: true };
    this.threadSupportPending = Promise.resolve();
  }
}

export const createListingRoom = (fetchFn?: typeof fetch) => {
  const mx = new ListingClient(fetchFn);
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  return { mx, room, engine };
};

/** The room lists its threads in pages, starting with one more page after its first. */
export const listInPages = (room: Room) => {
  Thread.hasServerSideListSupport = FeatureSupport.Stable;
  const list = room.getUnfilteredTimelineSet();
  room.threadsTimelineSets[0] = list;
  room.threadsTimelineSets[1] = list;
  const timeline = list.getLiveTimeline();
  timeline.setPaginationToken('older-roots', Direction.Backward);
  return timeline;
};

export const listedRoot = (eventId: string, body = eventId) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: roomId,
    sender: userId,
    origin_server_ts: 1000,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body },
  });

export const bundledReply = (eventId: string, threadRootId: string) => ({
  'm.relations': {
    'm.thread': {
      count: 1,
      current_user_participated: true,
      latest_event: {
        event_id: eventId,
        room_id: roomId,
        sender: userId,
        origin_server_ts: 1500,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: eventId,
          'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId },
        },
      },
    },
  },
});
