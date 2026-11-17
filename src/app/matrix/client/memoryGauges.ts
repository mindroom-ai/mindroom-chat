import type { MatrixClient, Room } from 'matrix-js-sdk';
import { registerMemoryGauge } from '../../diagnostics/memorySampler';

const sumRooms = (mx: MatrixClient, count: (room: Room) => number): number =>
  mx.getRooms().reduce((total, room) => total + count(room), 0);

/**
 * The client's share of the deep trace's memory samples: rooms, the events of their live
 * timelines, threads and the events of the threads' live timelines. Each reads only lengths, so a
 * sample costs one pass over rooms and threads. Returns the function that removes them, for when
 * the client stops.
 */
export const registerMatrixMemoryGauges = (mx: MatrixClient): (() => void) => {
  const unregister = [
    registerMemoryGauge('rooms', () => mx.getRooms().length),
    registerMemoryGauge('room_live_events', () =>
      sumRooms(mx, (room) => room.getLiveTimeline().getEvents().length)
    ),
    registerMemoryGauge('threads', () => sumRooms(mx, (room) => room.getThreads().length)),
    registerMemoryGauge('thread_events', () =>
      sumRooms(mx, (room) =>
        room
          .getThreads()
          .reduce((total, thread) => total + thread.liveTimeline.getEvents().length, 0)
      )
    ),
  ];
  return () => unregister.forEach((remove) => remove());
};
