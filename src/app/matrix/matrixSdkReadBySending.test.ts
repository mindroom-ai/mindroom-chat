import { createClient, EventStatus, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The SDK takes an event for read by a member who sent an event at or after it (matrix-js-sdk
// #5525), and looked for that event through the whole live timeline, past the event asked about.
// The row of readers under the timeline asks about the newest event for every joined member
// (RoomViewFollowing.tsx), so each member who has sent nothing cost a walk over every loaded event.
// It also takes a thread's root for read by a member who replied in the thread, and walked the
// whole thread for that. Our SDK patch makes each walk once for all members, as far back as the
// event asked about, and keeps what it found until the timeline changes.

const ROOM = '!room:example.org';
const ME = '@me:example.org';
const WRITER = '@writer:example.org';
const OTHER = '@other:example.org';
const ROOT_SENDER = '@root-sender:example.org';

const message = (id: string, sender: string, ts: number, threadRootId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    type: 'm.room.message',
    sender,
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: `message ${id}`,
      ...(threadRootId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } } : {}),
    },
  });

/**
 * A room whose live timeline holds `events`, oldest first, as history the client paged in: the SDK
 * makes up a read receipt for the sender of an event that arrives live, and none for these.
 */
const roomWithHistory = (events: MatrixEvent[]) => {
  const client = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM, client, ME, { timelineSupport: true });
  room.addEventsToTimeline([...events].reverse(), true, false, room.getLiveTimeline());
  return room;
};

const quietMembers = Array.from({ length: 50 }, (_, index) => `@quiet-${index}:example.org`);

/** How many times the SDK asks an event for its sender while `read` runs. */
const senderLookupsOf = (read: () => void): number => {
  const getSender = vi.spyOn(MatrixEvent.prototype, 'getSender');
  read();
  const lookups = getSender.mock.calls.length;
  getSender.mockRestore();
  return lookups;
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
    let readers: string[] = [];

    const lookups = senderLookupsOf(() => {
      readers = quietMembers.filter((userId) => room.hasUserReadEvent(userId, '$message-399'));
    });

    expect(readers).toEqual([]);
    // No more than one event's sender for each member, as before SDK 45; the whole history for
    // each would be 20,000.
    expect(lookups).toBeLessThanOrEqual(quietMembers.length * 2);
  });

  describe('a thread root that is the newest event of the room', () => {
    const REPLIES = 400;

    /** The room after its history, a root, and the root's thread with 400 replies of one member. */
    const roomWithThread = () => {
      const root = message('$root', ROOT_SENDER, 1_000);
      const room = roomWithHistory([message('$before', OTHER, 1), root]);
      const replies = Array.from({ length: REPLIES }, (_, index) =>
        message(`$reply-${index}`, index === 7 ? WRITER : OTHER, 2_000 + index, '$root')
      );
      const thread = room.createThread('$root', root, [root, ...replies], true);
      expect(thread.timeline).toHaveLength(REPLIES + 1);
      return { room, thread };
    };

    it('is read by the member who replied in its thread, and by no member who did not', () => {
      const { room } = roomWithThread();

      expect(room.hasUserReadEvent(WRITER, '$root')).toBe(true);
      expect(quietMembers.filter((userId) => room.hasUserReadEvent(userId, '$root'))).toEqual([]);
    });

    it('walks the thread once for all members, and not again until the thread changes', () => {
      const { room } = roomWithThread();
      const members = [...quietMembers, WRITER];
      const readers = () => members.filter((userId) => room.hasUserReadEvent(userId, '$root'));

      // Before the patch: the thread for each quiet member, 20,050 in all.
      expect(senderLookupsOf(() => expect(readers()).toEqual([WRITER]))).toBeLessThanOrEqual(
        REPLIES + 1 + members.length * 2
      );
      expect(senderLookupsOf(() => expect(readers()).toEqual([WRITER]))).toBeLessThanOrEqual(
        members.length * 2
      );
    });

    it('follows the replies that come, go, and are sent after it was asked', () => {
      const { room, thread } = roomWithThread();
      const QUIET = quietMembers[0] ?? '';
      expect(room.hasUserReadEvent(QUIET, '$root')).toBe(false);

      // A reply on its way to the server is none yet; once sent, with no change to the timeline, it is.
      const sending = message('~local', ME, 9_000, '$root');
      sending.setStatus(EventStatus.SENDING);
      thread.addEvent(sending, false);
      expect(room.hasUserReadEvent(ME, '$root')).toBe(false);
      sending.setStatus(null);
      expect(room.hasUserReadEvent(ME, '$root')).toBe(true);

      thread.addEvent(message('$late', QUIET, 9_001, '$root'), false);
      expect(room.hasUserReadEvent(QUIET, '$root')).toBe(true);

      thread.liveTimeline.removeEvent('$late');
      expect(room.hasUserReadEvent(QUIET, '$root')).toBe(false);
    });
  });

  it('walks the room once for all members when the event asked about is far back', () => {
    // A thread that has no reply yet shows its root as its newest event, wherever the room is by now.
    const history = Array.from({ length: 400 }, (_, index) =>
      message(`$message-${index}`, OTHER, index + 1)
    );
    const room = roomWithHistory(history);
    const members = [...quietMembers, WRITER];
    let readers: string[] = [];

    const lookups = senderLookupsOf(() => {
      readers = members.filter((userId) => room.hasUserReadEvent(userId, '$message-0'));
    });

    expect(readers).toEqual([]);
    expect(lookups).toBeLessThanOrEqual(history.length + members.length * 2);
    expect(room.hasUserReadEvent(OTHER, '$message-0')).toBe(true);
  });
});
