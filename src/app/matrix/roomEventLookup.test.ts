import { EventEmitter } from 'events';
import {
  EventTimelineSet,
  MatrixEvent,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isKnownRedactedEventId } from './eventRevision';
import { findRoomEvent, keepRoomEventLookupsCurrent } from './roomEventLookup';

// A room's lookup of an event it does not hold searches every thread of the room, and the views
// of a room's threads ask for the same few events once per thread.

const reply = new MatrixEvent({
  event_id: '$reply',
  origin_server_ts: 2000,
  type: 'm.room.message',
});

const makeRoom = () => {
  const held = new Map<string, MatrixEvent>();
  const findEventById = vi.fn((eventId: string) => held.get(eventId));
  const room = { roomId: '!room:example.org', findEventById } as unknown as Room;
  return {
    room,
    findEventById,
    hold: (event: MatrixEvent) => held.set(event.getId() ?? '', event),
  };
};

describe('findRoomEvent', () => {
  it('searches the room once for an event it does not hold, however often it is asked', () => {
    const { room, findEventById } = makeRoom();
    for (let i = 0; i < 50; i += 1) expect(findRoomEvent(room, '$edit')).toBeUndefined();
    expect(findEventById).toHaveBeenCalledTimes(1);
  });

  it('finds the event once it arrives in a later task', async () => {
    const { room, hold } = makeRoom();
    expect(findRoomEvent(room, '$reply')).toBeUndefined();
    hold(reply);
    await Promise.resolve();
    expect(findRoomEvent(room, '$reply')).toBe(reply);
  });

  it('finds the event once a timeline adds it, in the same task', () => {
    const mx = new EventEmitter();
    const stop = keepRoomEventLookupsCurrent(mx as unknown as MatrixClient);
    const { room, hold } = makeRoom();
    expect(findRoomEvent(room, '$reply')).toBeUndefined();
    hold(reply);
    mx.emit(RoomEvent.Timeline, reply, room);
    expect(findRoomEvent(room, '$reply')).toBe(reply);
    stop();
  });
});

// A room with threads that hold events in real SDK timeline sets: `Room.findEventById` reads its
// main timelines first, then each thread's set, in the room's order.
const timelineSetOf = (events: MatrixEvent[]) => {
  const timelineSet = new EventTimelineSet(undefined, { timelineSupport: true });
  events.forEach((event) =>
    timelineSet.addEventToTimeline(event, timelineSet.getLiveTimeline(), {
      toStartOfTimeline: false,
      addToState: false,
    })
  );
  return timelineSet;
};

const makeThreadedRoom = (timelineSets: EventTimelineSet[]) => {
  const threads = timelineSets.map((timelineSet) => ({
    timelineSet,
    findEventById: (eventId: string) => timelineSet.findEventById(eventId),
  }));
  const getThreads = vi.fn(() => threads);
  const room = {
    roomId: '!threads:example.org',
    getUnfilteredTimelineSet: () => timelineSetOf([]),
    getThreads,
  } as unknown as Room;
  return { room, getThreads };
};

const event = (eventId: string) =>
  new MatrixEvent({ event_id: eventId, origin_server_ts: 50, type: 'm.room.message' });

describe('findRoomEvent in a room of threads', () => {
  it('reads the threads once for every event they do not hold', () => {
    const held = event('$held');
    const { room, getThreads } = makeThreadedRoom([timelineSetOf([held]), timelineSetOf([])]);
    for (let i = 0; i < 50; i += 1) expect(findRoomEvent(room, `$edit${i}`)).toBeUndefined();
    expect(findRoomEvent(room, '$held')).toBe(held);
    expect(getThreads).toHaveBeenCalledTimes(1);
  });

  it('finds an event a page added to a timeline after a reset, as the room does', () => {
    // A reset without a forward token drops the old timelines from the set's list; a page that
    // was on its way still lands in the old one, which the set's lookup reads.
    const timelineSet = timelineSetOf([]);
    const old = timelineSet.getLiveTimeline();
    timelineSet.resetLiveTimeline();
    const paged = event('$paged');
    timelineSet.addEventsToTimeline([paged], true, false, old);
    expect(timelineSet.getTimelines()).not.toContain(old);
    const { room } = makeThreadedRoom([timelineSet]);
    expect(findRoomEvent(room, '$paged')).toBe(paged);
  });
});

describe('isKnownRedactedEventId', () => {
  it('reads the threads once for the edits of every thread, which no timeline holds', () => {
    const { room, getThreads } = makeThreadedRoom([timelineSetOf([event('$held')])]);
    for (let i = 0; i < 50; i += 1) expect(isKnownRedactedEventId(room, `$edit${i}`)).toBe(false);
    expect(getThreads).toHaveBeenCalledTimes(1);
  });
});
