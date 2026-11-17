import {
  createClient,
  EventStatus,
  EventTimelineSet,
  MatrixEvent,
  Room,
  RoomEvent,
  ThreadEvent,
  type MatrixClient,
  type Thread,
} from 'matrix-js-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { receiptEventsVersion, receiptReadTs } from './receiptReadTs';

// A receipt reads up to the event it names, or to when the server took it while the room does not
// hold that event. `receiptEventsVersion` counts what may move that, for the thread records kept
// from one build to the next.
let mx: MatrixClient;
let room: Room;

/** A message, or with `rootId` a reply in that thread. */
const message = (eventId: string, ts: number, rootId?: string): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: room.roomId,
    event_id: eventId,
    sender: '@alice:server',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: eventId,
      ...(rootId && { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } }),
    },
  });

beforeEach(() => {
  mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:server' });
  room = new Room('!room:server', mx, '@me:server');
});

describe('receiptEventsVersion', () => {
  it('counts a change when a timeline takes an event a receipt was read for', async () => {
    expect(receiptReadTs(room, room, '$late', 5000)).toBe(5000);
    const before = receiptEventsVersion(room);

    await room.addLiveEvents([message('$late', 1000)], { addToState: false });

    expect(receiptReadTs(room, room, '$late', 5000)).toBe(1000);
    expect(receiptEventsVersion(room)).toBe(before + 1);
    // An event no receipt was read for is no change.
    await room.addLiveEvents([message('$next', 2000)], { addToState: false });
    expect(receiptEventsVersion(room)).toBe(before + 1);
  });

  it('counts a change when a local echo takes the ID a receipt was read for', () => {
    const echo = message('~local', 1000);
    echo.setStatus(EventStatus.SENDING);
    room.addPendingEvent(echo, 'txn');
    expect(receiptReadTs(room, room, '$sent', 5000)).toBe(5000);
    const before = receiptEventsVersion(room);

    room.updatePendingEvent(echo, EventStatus.SENT, '$sent');

    expect(receiptReadTs(room, room, '$sent', 5000)).toBe(1000);
    expect(receiptEventsVersion(room)).toBe(before + 1);
  });

  it('counts a change when the local echo of a named event moves on, and for its room only', () => {
    const echo = message('$sent', 1000);
    echo.setStatus(EventStatus.SENDING);
    room.addPendingEvent(echo, 'txn');
    const other = new Room('!other:server', mx, '@me:server');
    expect(receiptReadTs(room, room, '$sent', 5000)).toBe(1000);
    expect(receiptReadTs(other, other, '$sent', 5000)).toBe(5000);
    const before = [receiptEventsVersion(room), receiptEventsVersion(other)];

    // The remote echo brings the server's time.
    room.emit(RoomEvent.LocalEchoUpdated, echo, room, '$sent', EventStatus.SENT);
    room.emit(RoomEvent.LocalEchoUpdated, message('$unasked', 1000), room);

    expect(receiptEventsVersion(room)).toBe(before[0]! + 1);
    expect(receiptEventsVersion(other)).toBe(before[1]);
  });

  it('counts a change when the room loses events, from its first lookup on', async () => {
    const named = message('$named', 1000);
    await room.addLiveEvents([named], { addToState: false });
    const thread = { findEventById: () => named } as unknown as Thread;
    // Answered by the thread: the room is listened to all the same.
    expect(receiptReadTs(room, thread, '$other', 5000)).toBe(1000);
    const before = receiptEventsVersion(room);

    room.emit(RoomEvent.Timeline, message('$other', 1000), room, undefined, true, {
      timeline: room.getLiveTimeline(),
    });
    expect(receiptEventsVersion(room)).toBe(before + 1);
    // Only the thread stand-in holds `$other`: the room cannot find it after any reset.
    room.getUnfilteredTimelineSet().resetLiveTimeline();
    expect(receiptEventsVersion(room)).toBe(before + 2);
    room.emit(ThreadEvent.Delete, thread);
    expect(receiptEventsVersion(room)).toBe(before + 3);
  });

  it('counts no change when a timeline drops an event no receipt was read for', async () => {
    await room.addLiveEvents([message('$named', 1000)], { addToState: false });
    expect(receiptReadTs(room, room, '$named', 5000)).toBe(1000);
    const before = receiptEventsVersion(room);

    // A redacted reaction leaves its thread: no receipt reads up to it.
    room.emit(RoomEvent.Timeline, message('$reaction', 1000), room, undefined, true, {
      timeline: room.getLiveTimeline(),
    });

    expect(receiptEventsVersion(room)).toBe(before);
  });

  it('counts a change when a timeline drops an event a receipt was read for', async () => {
    const named = message('$named', 1000);
    await room.addLiveEvents([named], { addToState: false });
    expect(receiptReadTs(room, room, '$named', 5000)).toBe(1000);
    const before = receiptEventsVersion(room);

    room.removeEvent('$named');

    expect(receiptReadTs(room, room, '$named', 5000)).toBe(5000);
    expect(receiptEventsVersion(room)).toBe(before + 1);
  });

  it("counts no change for what the room's lists of threads take or drop", async () => {
    const named = message('$named', 1000);
    await room.addLiveEvents([named], { addToState: false });
    expect(receiptReadTs(room, room, '$named', 5000)).toBe(1000);
    const before = receiptEventsVersion(room);
    const threadList = new EventTimelineSet(room, {});
    Object.assign(room, { threadsTimelineSets: [threadList, threadList] });

    // A reply moves its thread's root there: dropped, then taken again.
    room.emit(RoomEvent.Timeline, named, room, undefined, true, {
      timeline: threadList.getLiveTimeline(),
    });
    room.emit(RoomEvent.Timeline, named, room, false, false, {
      timeline: threadList.getLiveTimeline(),
    });
    room.emit(RoomEvent.TimelineReset, room, threadList, true);

    expect(receiptEventsVersion(room)).toBe(before);
  });

  describe('a timeline that starts over', () => {
    let thread: Thread;

    const addReply = (to: Thread, event: MatrixEvent) =>
      to.timelineSet.addEventToTimeline(event, to.liveTimeline, {
        toStartOfTimeline: false,
        addToState: false,
      });
    const threadOf = (rootId: string, ...replies: MatrixEvent[]): Thread => {
      const made = room.createThread(rootId, undefined, [], false);
      replies.forEach((event) => addReply(made, event));
      return made;
    };

    // A room that keeps its timelines, as the app's client makes them: a main timeline with
    // `$main`, the thread `$root` with `$reply`, and a receipt read for each.
    beforeEach(async () => {
      mx.supportsThreads = () => true;
      // The pagination tokens of a gap are converted with a request, which fails here.
      mx.createMessagesRequest = () => Promise.reject(new Error('offline'));
      room = new Room('!room:server', mx, '@me:server', { timelineSupport: true });
      await room.addLiveEvents([message('$main', 1000)], { addToState: false });
      thread = threadOf('$root', message('$reply', 2000, '$root'));
      expect(receiptReadTs(room, room, '$main', 5000)).toBe(1000);
      expect(receiptReadTs(room, thread, '$reply', 5000)).toBe(2000);
    });

    it('counts no change after a sync gap, when every timeline keeps its events', () => {
      const before = receiptEventsVersion(room);

      room.resetLiveTimeline('back', 'forward');
      void thread.flushPendingTimelineReset()?.catch(() => undefined);

      // Both started over, and the receipts still read up to their events.
      expect(room.getLiveTimeline().getEvents()).toEqual([]);
      expect(thread.events).toEqual([]);
      expect(receiptReadTs(room, room, '$main', 5000)).toBe(1000);
      expect(receiptReadTs(room, thread, '$reply', 5000)).toBe(2000);
      expect(receiptEventsVersion(room)).toBe(before);
    });

    it('counts a change when a thread timeline drops the event a receipt was read for', () => {
      const before = receiptEventsVersion(room);

      thread.timelineSet.resetLiveTimeline();

      expect(receiptReadTs(room, thread, '$reply', 5000)).toBe(5000);
      expect(receiptEventsVersion(room)).toBe(before + 1);
    });

    it('counts once more only when a named event is lost again', () => {
      thread.timelineSet.resetLiveTimeline();
      const before = receiptEventsVersion(room);

      // Its first page loaded: the thread tells of one more start, which dropped nothing.
      thread.emit(RoomEvent.TimelineReset, room, thread.timelineSet, true);
      room.getUnfilteredTimelineSet().resetLiveTimeline();
      room.getUnfilteredTimelineSet().resetLiveTimeline();

      expect(receiptEventsVersion(room)).toBe(before + 1);
    });

    it('counts no change when a timeline drops only events no receipt was read for', () => {
      const other = threadOf('$other', message('$unnamed', 3000, '$other'));
      const before = receiptEventsVersion(room);

      // A thread's first page replaces what it showed.
      other.timelineSet.resetLiveTimeline();

      expect(other.findEventById('$unnamed')).toBeUndefined();
      expect(receiptEventsVersion(room)).toBe(before);
    });

    it('counts a change when a timeline drops a named event it took after the lookup', () => {
      const other = threadOf('$other');
      expect(receiptReadTs(room, other, '$late', 5000)).toBe(5000);
      addReply(other, message('$late', 3000, '$other'));
      const before = receiptEventsVersion(room);

      other.timelineSet.resetLiveTimeline();

      expect(receiptEventsVersion(room)).toBe(before + 1);
    });

    it('counts no change for a named event the room was last found not to hold', () => {
      room.removeEvent('$main');
      expect(receiptReadTs(room, room, '$main', 5000)).toBe(5000);
      const before = receiptEventsVersion(room);

      room.getUnfilteredTimelineSet().resetLiveTimeline();

      expect(receiptEventsVersion(room)).toBe(before);
    });

    it('counts a change when the room timeline drops the event a receipt was read for', () => {
      const before = receiptEventsVersion(room);

      room.getUnfilteredTimelineSet().resetLiveTimeline();

      expect(receiptReadTs(room, room, '$main', 5000)).toBe(5000);
      expect(receiptEventsVersion(room)).toBe(before + 1);
    });
  });

  it('counts nothing for a room stand-in that tells nothing of its events', () => {
    const standIn = { findEventById: () => message('$named', 1000) } as unknown as Room;

    expect(receiptReadTs(standIn, standIn, '$named', 5000)).toBe(1000);
    expect(receiptEventsVersion(standIn)).toBe(0);
  });
});
