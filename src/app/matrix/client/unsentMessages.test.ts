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
import { clearUnsentMessages, keepUnsentMessages, unsentVoiceCopy } from './unsentMessages';

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
  it('leaves a voice message to its recording, which comes back as a recording', () => {
    const { room, stop } = setup();
    const voice = sendEcho(room, 'txn-voice', {
      msgtype: 'm.audio',
      body: 'Voice message',
      url: 'mxc://example.org/voice',
      'org.matrix.msc3245.voice': {},
    });
    room.updatePendingEvent(voice, EventStatus.NOT_SENT);
    expect(stored()).toEqual([]);
    stop();
  });

  /** A voice message as an older version kept it here while it was unsent. */
  const voiceRow = (txnId: string, size: number, inRoom = roomId) => ({
    roomId: inRoom,
    txnId,
    ts: 500,
    content: {
      msgtype: 'm.audio',
      body: 'Voice message',
      url: 'mxc://example.org/voice',
      info: { size, mimetype: 'audio/ogg' },
      'org.matrix.msc3245.voice': {},
    },
  });

  it('brings back a voice message an older version kept, and forgets it for good once it is deleted', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([voiceRow('txn-old-voice', 4_096)]));
    const first = setup();
    first.mx.emit(ClientEvent.Sync, SyncState.Prepared, null);
    // It is the only copy of that send: back as "Not sent", with Retry and Delete.
    const restored = first.room.getEventForTxnId('txn-old-voice');
    expect(restored?.status).toBe(EventStatus.NOT_SENT);
    expect(stored().map((message) => message.txnId)).toEqual(['txn-old-voice']);

    first.room.updatePendingEvent(restored!, EventStatus.CANCELLED);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    first.stop();

    // The next page does not bring it back.
    const next = setup();
    next.mx.emit(ClientEvent.Sync, SyncState.Prepared, null);
    expect(next.room.getEventForTxnId('txn-old-voice')).toBeUndefined();
    next.stop();
  });

  it('forgets a voice message an older version kept once the server has it', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([voiceRow('txn-old-voice', 4_096)]));
    const { mx, room, stop } = setup();
    mx.emit(ClientEvent.Sync, SyncState.Prepared, null);
    // Retry: on its way again it stays, the only copy still.
    const echo = room.getEventForTxnId('txn-old-voice')!;
    room.updatePendingEvent(echo, EventStatus.SENDING);
    expect(stored()).toHaveLength(1);
    room.updatePendingEvent(echo, EventStatus.SENT, '$voice');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    stop();
  });

  it('gives the recording of the same send the transaction ID of its unsent copy, and forgets the copy', () => {
    const others = [
      { roomId, txnId: 'txn-text', content: text('typed'), ts: 400 },
      voiceRow('txn-other-size', 9_999),
      voiceRow('txn-other-room', 4_096, '!elsewhere:example.org'),
    ];
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...others, voiceRow('txn-old-retry', 4_096)])
    );
    const { mx, room, stop } = setup();
    // Nothing of that size in that room: the recording is not that send.
    expect(unsentVoiceCopy(mx, roomId, 1_234)).toBeUndefined();

    mx.emit(ClientEvent.Sync, SyncState.Prepared, null);
    const copy = unsentVoiceCopy(mx, roomId, 4_096);
    expect(copy?.txnId).toBe('txn-old-retry');
    // Not forgotten before the recording holds the ID.
    expect(room.getEventForTxnId('txn-old-retry')?.status).toBe(EventStatus.NOT_SENT);
    expect(stored()).toHaveLength(4);

    copy!.forget();
    // One copy to send again is left, the recording: its unsent row and echo are gone, and the
    // room gave the ID back for the recording's Retry.
    expect(room.getEventForTxnId('txn-old-retry')).toBeUndefined();
    expect(stored().map((message) => message.txnId)).toEqual(others.map((other) => other.txnId));
    stop();
  });

  it('forgets the unsent copy of a recording before its row came back as an echo', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([voiceRow('txn-old-retry', 4_096)]));
    const { mx, room, stop } = setup();
    unsentVoiceCopy(mx, roomId, 4_096)!.forget();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    mx.emit(ClientEvent.Sync, SyncState.Prepared, null);
    expect(room.getEventForTxnId('txn-old-retry')).toBeUndefined();
    stop();
  });

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
