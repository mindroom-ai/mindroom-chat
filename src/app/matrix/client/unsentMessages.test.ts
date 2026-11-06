// @vitest-environment jsdom
import {
  ClientEvent,
  createClient,
  EventStatus,
  MatrixEvent,
  PendingEventOrdering,
  Room,
  RoomEvent,
  SyncState,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearUnsentMessages, keepUnsentMessages } from './unsentMessages';

const userId = '@alice:example.org';
const roomId = '!room:example.org';
const STORAGE_KEY = `unsentMessages:${userId}`;

const stored = (): Array<{ roomId: string; txnId: string; content: Record<string, unknown> }> =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');

const setup = () => {
  const mx: MatrixClient = createClient({ baseUrl: 'https://example.org', userId });
  const room = new Room(roomId, mx, userId, {
    pendingEventOrdering: PendingEventOrdering.Chronological,
  });
  mx.store.storeRoom(room);
  mx.reEmitter.reEmit(room, [RoomEvent.LocalEchoUpdated]);
  const stop = keepUnsentMessages(mx);
  return { mx, room, stop };
};

/** A local echo as the SDK creates it when a message is sent. */
const sendEcho = (room: Room, txnId: string, content: Record<string, unknown>) => {
  const event = new MatrixEvent({
    type: 'm.room.message',
    content,
    event_id: `~${roomId}:${txnId}`,
    sender: userId,
    room_id: roomId,
    origin_server_ts: 1_000,
  });
  event.setTxnId(txnId);
  event.setStatus(EventStatus.SENDING);
  room.addPendingEvent(event, txnId);
  return event;
};

const text = (body: string, extra: Record<string, unknown> = {}) => ({
  msgtype: 'm.text',
  body,
  ...extra,
});

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('keepUnsentMessages', () => {
  it('keeps a typed message in storage until the server has it, or it is deleted', () => {
    const { room, stop } = setup();
    const first = sendEcho(room, 'txn-1', text('first'));
    const second = sendEcho(room, 'txn-2', text('second'));
    expect(stored().map((message) => message.txnId)).toEqual(['txn-1', 'txn-2']);

    // Unsent, it stays where it was.
    room.updatePendingEvent(second, EventStatus.NOT_SENT);
    expect(stored().map((message) => message.txnId)).toEqual(['txn-1', 'txn-2']);
    expect(stored()[1]?.content).toEqual(text('second'));

    room.updatePendingEvent(first, EventStatus.SENT, '$first');
    expect(stored().map((message) => message.txnId)).toEqual(['txn-2']);

    room.updatePendingEvent(second, EventStatus.CANCELLED);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    stop();
  });

  it('keeps uploaded attachments and long texts, but not edits or an encrypted attachment', () => {
    const { room, stop } = setup();
    sendEcho(room, 'txn-edit', {
      ...text('* fixed'),
      'm.new_content': text('fixed'),
      'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
    });
    sendEcho(room, 'txn-file', { msgtype: 'm.file', body: 'notes.txt', url: 'mxc://x/notes' });
    sendEcho(room, 'txn-secret', {
      msgtype: 'm.image',
      body: 'photo.jpg',
      file: { url: 'mxc://x/photo', key: { k: 'secret' } },
    });
    sendEcho(room, 'txn-long', {
      msgtype: 'm.file',
      body: 'A long message…',
      file: { url: 'mxc://x/long', key: { k: 'text-key' } },
      'io.mindroom.long_text': { version: 2 },
    });
    expect(stored().map((message) => message.txnId)).toEqual(['txn-file', 'txn-long']);
    stop();
  });

  it('asks before the page goes away while anything is still being sent', () => {
    const { room, stop } = setup();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    const echo = sendEcho(room, 'txn-1', text('on its way'));
    expect(leave()).toBe(true);
    // A failed message is kept for the next start; nothing is on its way any more.
    room.updatePendingEvent(echo, EventStatus.NOT_SENT);
    expect(leave()).toBe(false);
    stop();
    sendEcho(room, 'txn-2', text('after stop'));
    expect(leave()).toBe(false);
  });

  it('puts the messages a previous page left unsent back as Not sent rows, threads included', () => {
    const reply = text('reply in the thread', {
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root', is_falling_back: true },
    });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { roomId, txnId: 'txn-old-1', content: text('left behind'), ts: 500 },
        { roomId, txnId: 'txn-old-2', content: reply, ts: 600 },
        { roomId: '!unknown:example.org', txnId: 'txn-elsewhere', content: text('x'), ts: 700 },
      ])
    );
    const { mx, room, stop } = setup();
    expect(room.getEventForTxnId('txn-old-1')).toBeUndefined();

    mx.emit(ClientEvent.Sync, SyncState.Prepared, null);

    const restored = room.getEventForTxnId('txn-old-1');
    expect(restored?.status).toBe(EventStatus.NOT_SENT);
    expect(restored?.getContent()).toEqual(text('left behind'));
    expect(restored?.getId()).toBe(`~${roomId}:txn-old-1`);
    const restoredReply = room.getEventForTxnId('txn-old-2');
    expect(restoredReply?.status).toBe(EventStatus.NOT_SENT);
    expect(restoredReply?.threadRootId).toBe('$root');
    // A room this start does not know keeps its message for a later start.
    expect(
      stored()
        .map((message) => message.txnId)
        .sort()
    ).toEqual(['txn-elsewhere', 'txn-old-1', 'txn-old-2']);

    // The restore runs once per start.
    mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
    const copies = room
      .getLiveTimeline()
      .getEvents()
      .filter((event) => event.getId() === `~${roomId}:txn-old-1`);
    expect(copies).toHaveLength(1);
    stop();
  });

  it('drops a message whose send reached the server before the page went away', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ roomId, txnId: 'txn-arrived', content: text('arrived'), ts: 500 }])
    );
    const { mx, room, stop } = setup();
    await room.addLiveEvents(
      [
        new MatrixEvent({
          type: 'm.room.message',
          content: text('arrived'),
          event_id: '$arrived',
          sender: userId,
          room_id: roomId,
          origin_server_ts: 500,
          unsigned: { transaction_id: 'txn-arrived' },
        }),
      ],
      { addToState: false }
    );

    mx.emit(ClientEvent.Sync, SyncState.Prepared, null);

    expect(room.getEventForTxnId('txn-arrived')).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    stop();
  });

  it('forgets an account’s unsent messages on sign-out', () => {
    localStorage.setItem(STORAGE_KEY, '[]');
    localStorage.setItem('unsentMessages:@bob:example.org', '[]');
    clearUnsentMessages(userId);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('unsentMessages:@bob:example.org')).toBe('[]');
  });
});
