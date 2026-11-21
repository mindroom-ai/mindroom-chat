import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The SDK takes an event for read by a member who sent an event at or after it (matrix-js-sdk
// #5525), and looked for that event through the whole live timeline, past the event asked about.
// The row of readers under the timeline asks about the newest event for every joined member
// (RoomViewFollowing.tsx), so each member who has sent nothing cost a walk over every loaded event.
// Our SDK patch ends the search at the event asked about: what a member sent before it says
// nothing of whether they read it.

const ROOM = '!room:example.org';
const ME = '@me:example.org';
const WRITER = '@writer:example.org';
const OTHER = '@other:example.org';

const message = (id: string, sender: string, ts: number) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    type: 'm.room.message',
    sender,
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: `message ${id}` },
  });

/**
 * A room whose live timeline holds `events`, oldest first, as history the client paged in: the SDK
 * makes up a read receipt for the sender of an event that arrives live, and none for these.
 */
const roomWithHistory = (events: MatrixEvent[]) => {
  const client = createClient({ baseUrl: 'https://example.org', userId: ME });
  const room = new Room(ROOM, client, ME, { timelineSupport: true });
  room.addEventsToTimeline([...events].reverse(), true, false, room.getLiveTimeline());
  return room;
};

describe('SDK: an event read by a member who sent a later one', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts the events up to the last one a member sent as read by them, and none after it', () => {
    const room = roomWithHistory([
      message('$first', OTHER, 1),
      message('$second', OTHER, 2),
      message('$written', WRITER, 3),
      message('$after', OTHER, 4),
      message('$latest', OTHER, 5),
    ]);

    expect(room.getLiveTimeline().getEvents()).toHaveLength(5);
    expect(room.hasUserReadEvent(WRITER, '$first')).toBe(true);
    expect(room.hasUserReadEvent(WRITER, '$second')).toBe(true);
    expect(room.hasUserReadEvent(WRITER, '$written')).toBe(true);
    expect(room.hasUserReadEvent(WRITER, '$after')).toBe(false);
    expect(room.hasUserReadEvent(WRITER, '$latest')).toBe(false);
  });

  it('looks no further back than the newest event for the members who have sent nothing', () => {
    const history = Array.from({ length: 400 }, (_, index) =>
      message(`$message-${index}`, WRITER, index + 1)
    );
    const room = roomWithHistory(history);
    const quietMembers = Array.from({ length: 50 }, (_, index) => `@quiet-${index}:example.org`);
    const getSender = vi.spyOn(MatrixEvent.prototype, 'getSender');

    const readers = quietMembers.filter((userId) => room.hasUserReadEvent(userId, '$message-399'));

    expect(readers).toEqual([]);
    // One event's sender for each member, as before SDK 45; the whole history would be 20,000.
    expect(getSender.mock.calls.length).toBeLessThanOrEqual(quietMembers.length * 2);
  });
});
