import {
  createClient,
  EventStatus,
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

  it('finds the named event in a thread that came with it', () => {
    expect(receiptReadTs(room, room, '$reply', 5000)).toBe(5000);
    const before = receiptEventsVersion();
    const reply = message('$reply', 1000);
    const thread = {
      findEventById: (eventId: string) => (eventId === '$reply' ? reply : undefined),
    };
    vi.spyOn(room, 'findEventById').mockImplementation((eventId) =>
      eventId === '$reply' ? reply : undefined
    );

    room.emit(ThreadEvent.New, thread as unknown as Thread, false);

    expect(receiptReadTs(room, room, '$reply', 5000)).toBe(1000);
    expect(receiptEventsVersion()).toBe(before + 1);
    // A thread without the event leaves the answer as it is.
    expect(receiptReadTs(room, room, '$other', 5000)).toBe(5000);
    room.emit(ThreadEvent.New, thread as unknown as Thread, false);
    expect(receiptEventsVersion()).toBe(before + 1);
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
    const before = receiptEventsVersion();

    room.emit(RoomEvent.Timeline, named, room, undefined, true, {
      timeline: room.getLiveTimeline(),
    });
    expect(receiptEventsVersion()).toBe(before + 1);
    room.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), true);
    expect(receiptEventsVersion()).toBe(before + 2);
    room.emit(ThreadEvent.Delete, thread);
    expect(receiptEventsVersion()).toBe(before + 3);
    // An event a timeline takes that no receipt waited for is no change.
    await room.addLiveEvents([message('$next', 2000)], { addToState: false });
    expect(receiptEventsVersion()).toBe(before + 3);
  });

  it('keeps no answer for a room stand-in that tells nothing of its events', () => {
    const findEventById = vi.fn<(eventId: string) => MatrixEvent | undefined>(() => undefined);
    const standIn = { findEventById } as unknown as Room;

    expect(receiptReadTs(standIn, standIn, '$late', 5000)).toBe(5000);
    findEventById.mockReturnValue(message('$late', 1000));

    expect(receiptReadTs(standIn, standIn, '$late', 5000)).toBe(1000);
  });
});
