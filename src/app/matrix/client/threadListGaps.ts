import {
  Direction,
  RoomEvent,
  THREAD_RELATION_TYPE,
  ThreadFilterType,
  type EventTimelineSet,
  type IThreadBundledRelationship,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { watchRoomThreads } from '../watchRoomThreads';

// A /sync answer carries at most the filter's events per room. Past that it is `limited`: the SDK
// starts the room's timeline again after the gap, and the events in the gap never arrive. The SDK
// reads the server's thread list once per room, so a thread that started in a gap had no card, and
// an unopened thread whose newest reply or title came in a gap kept its old summary. A page that
// falls behind, as a loaded phone does while many agents stream, gets gap after gap. After each
// gap in a room whose thread list was read, this reads the list again, newest activity first, down
// to the activity the room knew before the gap; the SDK adds the threads it lacked and refreshes
// the summaries of unopened ones.

/** Roots per thread list page. */
const PAGE_SIZE = 30;

const threadActivityTs = (thread: Thread): number =>
  (thread.replyToEvent ?? thread.rootEvent)?.getTs() ?? 0;

const listedActivityTs = (root: MatrixEvent): number =>
  root.getServerAggregatedRelation<IThreadBundledRelationship>(THREAD_RELATION_TYPE.name)
    ?.latest_event?.origin_server_ts ?? root.getTs();

/**
 * Reads the room's thread list from its newest activity until a root is no newer than `knownTs`
 * (the list is in order of latest activity) or the list ends, and hands each page to the SDK.
 */
const relistSince = async (mx: MatrixClient, room: Room, knownTs: number): Promise<void> => {
  const mapper = mx.getEventMapper();
  let from: string | null = null;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await mx.createThreadListMessagesRequest(
      room.roomId,
      from,
      PAGE_SIZE,
      Direction.Backward,
      ThreadFilterType.All
    );
    const roots = page.chunk.map((event) => mapper({ ...event, room_id: room.roomId }));
    const news = roots.filter((root) => listedActivityTs(root) > knownTs);
    room.processListedThreadRoots(news, false);
    if (news.length < roots.length || !page.end || page.end === from) return;
    from = page.end;
  }
};

/**
 * Reads a room's thread list again after each limited sync, for the client's whole life, in the
 * rooms whose list the app read (a room's thread list view creates its thread list timelines);
 * call it before the client starts. Returns a function that stops it.
 */
export const relistThreadsAfterGaps = (mx: MatrixClient): (() => void) => {
  // One read per room at a time; a gap during a read starts one more read from that gap.
  const reading = new Map<Room, { again?: number }>();

  const read = (room: Room, knownTs: number) => {
    const current = reading.get(room);
    if (current) {
      current.again = Math.min(current.again ?? knownTs, knownTs);
      return;
    }
    const state: { again?: number } = {};
    reading.set(room, state);
    relistSince(mx, room, knownTs)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[threadList] reading the thread list after a sync gap failed:', error);
      })
      .finally(() => {
        reading.delete(room);
        if (state.again !== undefined) read(room, state.again);
      });
  };

  return watchRoomThreads(mx, {
    onThread: () => undefined,
    onRoom: (room) => {
      const onReset = (_room: Room | undefined, timelineSet: EventTimelineSet | undefined) => {
        // Only the room's own timeline resets at a gap; a thread's timeline resets for other reasons.
        if (timelineSet !== room.getUnfilteredTimelineSet()) return;
        if (room.threadsTimelineSets.length === 0) return;
        // The reset comes before the events after the gap, so the threads still show what the
        // room knew before it.
        const knownTs = Math.max(0, ...room.getThreads().map(threadActivityTs));
        read(room, knownTs);
      };
      room.on(RoomEvent.TimelineReset, onReset);
      return () => {
        room.removeListener(RoomEvent.TimelineReset, onReset);
      };
    },
  });
};
