import type { MatrixClient } from 'matrix-js-sdk';
import { registerMemoryGauges } from '../../diagnostics/memorySampler';

/**
 * The client's share of the deep trace's memory samples: rooms, the events of their live
 * timelines, threads and the events of the threads' live timelines. One pass over rooms and their
 * threads reads only lengths. Returns the function that removes them, for when the client stops.
 */
export const registerMatrixMemoryGauges = (mx: MatrixClient): (() => void) =>
  registerMemoryGauges('matrix', () => {
    const rooms = mx.getRooms();
    let roomLiveEvents = 0;
    let threads = 0;
    let threadEvents = 0;
    rooms.forEach((room) => {
      roomLiveEvents += room.getLiveTimeline().getEvents().length;
      const roomThreads = room.getThreads();
      threads += roomThreads.length;
      roomThreads.forEach((thread) => {
        threadEvents += thread.liveTimeline.getEvents().length;
      });
    });
    return {
      rooms: rooms.length,
      room_live_events: roomLiveEvents,
      threads,
      thread_events: threadEvents,
    };
  });
