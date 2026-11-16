import { EventEmitter } from 'events';
import { MatrixEvent, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
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

// A room with threads that hold events, as `findEventById` reads it: its main timelines first, then
// each thread's timelines, in the room's order.
const makeThreadedRoom = (threadEvents: MatrixEvent[][]) => {
  const threads = threadEvents.map((events) => ({
    timelineSet: { getTimelines: () => [{ getEvents: () => events }] },
  }));
  const getThreads = vi.fn(() => threads);
  const room = {
    roomId: '!threads:example.org',
    getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
    getThreads,
  } as unknown as Room;
  return { room, getThreads };
};

describe('findRoomEvent in a room of threads', () => {
  it('reads the threads once for every event they do not hold', () => {
    const { room, getThreads } = makeThreadedRoom([[reply], []]);
    for (let i = 0; i < 50; i += 1) expect(findRoomEvent(room, `$edit${i}`)).toBeUndefined();
    expect(findRoomEvent(room, '$reply')).toBe(reply);
    expect(getThreads).toHaveBeenCalledTimes(1);
  });
});

describe('isKnownRedactedEventId', () => {
  it('reads the threads once for the edits of every thread, which no timeline holds', () => {
    const { room, getThreads } = makeThreadedRoom([[reply]]);
    for (let i = 0; i < 50; i += 1) expect(isKnownRedactedEventId(room, `$edit${i}`)).toBe(false);
    expect(getThreads).toHaveBeenCalledTimes(1);
  });
});
