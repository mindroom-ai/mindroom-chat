import { EventEmitter } from 'events';
import {
  DuplicateStrategy,
  EventTimelineSet,
  MatrixEvent,
  RoomEvent,
  type MatrixClient,
  type Room,
  type RoomState,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isKnownRedactedEventId } from './eventRevision';
import { findRoomEvent, keepRoomEventLookupsCurrent } from './roomEventLookup';

// A room's lookup of an event it does not hold searches every thread of the room, and the views
// of a room's threads ask for events no timeline holds once per thread.

const event = (eventId: string) =>
  new MatrixEvent({ event_id: eventId, origin_server_ts: 50, type: 'm.room.message' });

// A timeline set of the SDK, holding `events` in its live timeline.
const timelineSetOf = (events: MatrixEvent[]) => {
  const timelineSet = new EventTimelineSet(undefined, { timelineSupport: true });
  events.forEach((held) =>
    timelineSet.addEventToTimeline(held, timelineSet.getLiveTimeline(), {
      toStartOfTimeline: false,
      addToState: false,
    })
  );
  return timelineSet;
};

// A room whose threads hold events in SDK timeline sets. Its search reads the main timelines, then
// each thread in order; `search` stands in for the patched SDK's, whose memory of the thread that
// held an event can pick another one.
const makeRoom = (
  timelineSets: EventTimelineSet[],
  search?: (eventId: string) => MatrixEvent | undefined
) => {
  const threads = timelineSets.map((timelineSet) => ({
    timelineSet,
    findEventById: (eventId: string) => timelineSet.findEventById(eventId),
  }));
  const getThreads = vi.fn(() => threads);
  const main = timelineSetOf([]);
  const findEventById = vi.fn(
    search ??
      ((eventId: string) =>
        main.findEventById(eventId) ??
        threads.map((thread) => thread.findEventById(eventId)).find(Boolean))
  );
  const room = {
    roomId: '!room:example.org',
    getUnfilteredTimelineSet: () => main,
    getThreads,
    findEventById,
  } as unknown as Room;
  return { room, getThreads, findEventById };
};

describe('findRoomEvent', () => {
  it('reads the threads once for every event they do not hold, and never searches for one', () => {
    const held = event('$held');
    const { room, getThreads, findEventById } = makeRoom([
      timelineSetOf([held]),
      timelineSetOf([]),
    ]);
    for (let i = 0; i < 50; i += 1) expect(findRoomEvent(room, `$edit${i}`)).toBeUndefined();
    expect(findEventById).not.toHaveBeenCalled();
    expect(findRoomEvent(room, '$held')).toBe(held);
    expect(getThreads).toHaveBeenCalledTimes(1);
  });

  it('finds an event a timeline added without telling, in a later task', async () => {
    const timelineSet = timelineSetOf([]);
    const { room } = makeRoom([timelineSet]);
    expect(findRoomEvent(room, '$reply')).toBeUndefined();
    const reply = event('$reply');
    timelineSet.addEventToTimeline(reply, timelineSet.getLiveTimeline(), {
      toStartOfTimeline: false,
      addToState: false,
    });
    await Promise.resolve();
    expect(findRoomEvent(room, '$reply')).toBe(reply);
  });

  it('finds the event once a timeline adds it, in the same task', () => {
    const mx = new EventEmitter();
    const stop = keepRoomEventLookupsCurrent(mx as unknown as MatrixClient);
    const timelineSet = timelineSetOf([]);
    const { room } = makeRoom([timelineSet]);
    expect(findRoomEvent(room, '$reply')).toBeUndefined();
    const reply = event('$reply');
    timelineSet.addEventToTimeline(reply, timelineSet.getLiveTimeline(), {
      toStartOfTimeline: false,
      addToState: false,
    });
    mx.emit(RoomEvent.Timeline, reply, room);
    expect(findRoomEvent(room, '$reply')).toBe(reply);
    stop();
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
    const { room } = makeRoom([timelineSet]);
    expect(findRoomEvent(room, '$paged')).toBe(paged);
  });

  it('finds the copy a timeline put in place of the one it held, in the same task', () => {
    const timelineSet = timelineSetOf([event('$held')]);
    const { room } = makeRoom([timelineSet]);
    expect(findRoomEvent(room, '$held')).toBeDefined();
    // A duplicate the SDK puts in place of the event it held, telling nobody.
    const copy = event('$held');
    timelineSet.addLiveEvent(copy, {
      duplicateStrategy: DuplicateStrategy.Replace,
      addToState: false,
      roomState: { getSentinelMember: () => null } as unknown as RoomState,
    });
    expect(findRoomEvent(room, '$held')).toBe(copy);
  });

  it("answers for an event two threads hold as the room's own search does", () => {
    const later = event('$both');
    const { room } = makeRoom(
      [timelineSetOf([event('$both')]), timelineSetOf([later])],
      (eventId) => (eventId === '$both' ? later : undefined)
    );
    expect(findRoomEvent(room, '$both')).toBe(later);
  });
});

describe('isKnownRedactedEventId', () => {
  it('reads the threads once for the edits of every thread, which no timeline holds', () => {
    const { room, getThreads } = makeRoom([timelineSetOf([event('$held')])]);
    for (let i = 0; i < 50; i += 1) expect(isKnownRedactedEventId(room, `$edit${i}`)).toBe(false);
    expect(getThreads).toHaveBeenCalledTimes(1);
  });
});
