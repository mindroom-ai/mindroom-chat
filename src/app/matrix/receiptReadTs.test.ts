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

const message = (eventId: string, ts: number): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: room.roomId,
    event_id: eventId,
    sender: '@alice:server',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: eventId },
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
    room.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), true);
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

  it('counts nothing for a room stand-in that tells nothing of its events', () => {
    const standIn = { findEventById: () => message('$named', 1000) } as unknown as Room;

    expect(receiptReadTs(standIn, standIn, '$named', 5000)).toBe(1000);
    expect(receiptEventsVersion(standIn)).toBe(0);
  });
});
