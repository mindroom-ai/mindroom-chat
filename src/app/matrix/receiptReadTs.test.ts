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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receiptEventsVersion, receiptReadTs } from './receiptReadTs';

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

describe('receiptReadTs', () => {
  it('reads up to the event the receipt names', async () => {
    await room.addLiveEvents([message('$named', 1000)], { addToState: false });

    expect(receiptReadTs(room, room, '$named', 5000)).toBe(1000);
  });

  it('asks the threads of the room once for an event the client does not hold', () => {
    const getThreads = vi.spyOn(room, 'getThreads');

    expect(receiptReadTs(room, room, '$edit', 5000)).toBe(5000);
    expect(receiptReadTs(room, room, '$edit', 5000)).toBe(5000);
    expect(receiptReadTs(room, room, '$edit', 7000)).toBe(7000);

    expect(getThreads).toHaveBeenCalledTimes(1);
  });

  it('finds the named event once a timeline of the room holds it', async () => {
    expect(receiptReadTs(room, room, '$late', 5000)).toBe(5000);

    await room.addLiveEvents([message('$late', 1000)], { addToState: false });

    expect(receiptReadTs(room, room, '$late', 5000)).toBe(1000);
  });

  it('finds the named event once a local echo takes its ID', () => {
    const echo = message('~local', 1000);
    echo.setStatus(EventStatus.SENDING);
    room.addPendingEvent(echo, 'txn');
    expect(receiptReadTs(room, room, '$sent', 5000)).toBe(5000);

    room.updatePendingEvent(echo, EventStatus.SENT, '$sent');

    expect(receiptReadTs(room, room, '$sent', 5000)).toBe(1000);
  });

  it("finds the named event once the room passes on that a thread's timeline took it", () => {
    expect(receiptReadTs(room, room, '$reply', 5000)).toBe(5000);
    const before = receiptEventsVersion(room);
    const reply = message('$reply', 1000);
    vi.spyOn(room, 'findEventById').mockImplementation((eventId) =>
      eventId === '$reply' ? reply : undefined
    );

    // As the room passes on what a thread's timeline takes.
    room.emit(RoomEvent.Timeline, reply, room, false, false, {
      timeline: new EventTimelineSet(room, {}).getLiveTimeline(),
    });

    expect(receiptReadTs(room, room, '$reply', 5000)).toBe(1000);
    expect(receiptEventsVersion(room)).toBe(before + 1);
  });

  it('asks the thread a receipt is read in first, also for an event the room did not hold', () => {
    expect(receiptReadTs(room, room, '$reply', 5000)).toBe(5000);
    const thread = { findEventById: () => message('$reply', 1000) } as unknown as Thread;

    expect(receiptReadTs(room, thread, '$reply', 5000)).toBe(1000);
  });

  it('counts a change when the room loses events, from its first lookup on', async () => {
    const named = message('$named', 1000);
    await room.addLiveEvents([named], { addToState: false });
    const thread = { findEventById: () => named } as unknown as Thread;
    // Answered by the thread: the room is listened to all the same.
    expect(receiptReadTs(room, thread, '$named', 5000)).toBe(1000);
    const before = receiptEventsVersion(room);

    room.emit(RoomEvent.Timeline, named, room, undefined, true, {
      timeline: room.getLiveTimeline(),
    });
    expect(receiptEventsVersion(room)).toBe(before + 1);
    room.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), true);
    expect(receiptEventsVersion(room)).toBe(before + 2);
    room.emit(ThreadEvent.Delete, thread);
    expect(receiptEventsVersion(room)).toBe(before + 3);
    // An event a timeline takes that no receipt waited for is no change.
    await room.addLiveEvents([message('$next', 2000)], { addToState: false });
    expect(receiptEventsVersion(room)).toBe(before + 3);
  });

  it("counts no change for a root that moves in the room's lists of threads", async () => {
    const named = message('$named', 1000);
    await room.addLiveEvents([named], { addToState: false });
    expect(receiptReadTs(room, room, '$named', 5000)).toBe(1000);
    const before = receiptEventsVersion(room);
    const threadList = new EventTimelineSet(room, {});
    Object.assign(room, { threadsTimelineSets: [threadList, threadList] });

    room.emit(RoomEvent.Timeline, named, room, undefined, true, {
      timeline: threadList.getLiveTimeline(),
    });
    room.emit(RoomEvent.TimelineReset, room, threadList, true);
    // Nor for a root the room does not hold that the lists take again.
    expect(receiptReadTs(room, room, '$listed', 5000)).toBe(5000);
    room.emit(RoomEvent.Timeline, message('$listed', 1000), room, false, false, {
      timeline: threadList.getLiveTimeline(),
    });

    expect(receiptEventsVersion(room)).toBe(before);
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

  it('keeps no answer for a room stand-in that tells nothing of its events', () => {
    const findEventById = vi.fn<(eventId: string) => MatrixEvent | undefined>(() => undefined);
    const standIn = { findEventById } as unknown as Room;

    expect(receiptReadTs(standIn, standIn, '$late', 5000)).toBe(5000);
    findEventById.mockReturnValue(message('$late', 1000));

    expect(receiptReadTs(standIn, standIn, '$late', 5000)).toBe(1000);
  });
});
