import { createClient, EventStatus, MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receiptReadTs } from './receiptReadTs';

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

  it('keeps no answer for a room stand-in that tells nothing of its events', () => {
    const findEventById = vi.fn<[string], MatrixEvent | undefined>(() => undefined);
    const standIn = { findEventById } as unknown as Room;

    expect(receiptReadTs(standIn, standIn, '$late', 5000)).toBe(5000);
    findEventById.mockReturnValue(message('$late', 1000));

    expect(receiptReadTs(standIn, standIn, '$late', 5000)).toBe(1000);
  });
});
