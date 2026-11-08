import { ClientEvent, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  getFinishingEdit,
  getSyncedEdit,
  isStreamingByServer,
  keepSyncedEdits,
} from './syncedEdits';
import { isEventStreaming } from '../../event-store/threads/useThreadStreamingState';

// Regression (P2-e2ee-F002): a device without the room's keys showed a stopped reply as streaming
// for good. The SDK never puts an edit it cannot decrypt on its reply, but MindRoom keeps each
// edit's stream status outside the encrypted payload.

const AGENT = '@mindroom_helper:example.org';

const reply = new MatrixEvent({
  type: 'm.room.encrypted',
  event_id: '$reply',
  room_id: '!room:example.org',
  sender: AGENT,
  origin_server_ts: 1,
  content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'opaque' },
});

const edit = (eventId: string, ts: number, status: string, sender = AGENT) =>
  new MatrixEvent({
    type: 'm.room.encrypted',
    event_id: eventId,
    room_id: '!room:example.org',
    sender,
    origin_server_ts: ts,
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      'io.mindroom.stream_status': status,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    },
  });

describe('the edit that finished a reply', () => {
  it('is known from its status in the clear, without the room keys', () => {
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => null,
    }) as unknown as MatrixClient;
    keepSyncedEdits(mx);
    expect(getFinishingEdit(reply)).toBeUndefined();

    mx.emit(ClientEvent.Event, edit('$streaming', 2, 'streaming'));
    expect(getFinishingEdit(reply)).toBeUndefined();

    // Only the reply's sender can finish it.
    mx.emit(ClientEvent.Event, edit('$forged', 3, 'completed', '@someone:example.org'));
    expect(getFinishingEdit(reply)).toBeUndefined();

    mx.emit(ClientEvent.Event, edit('$stopped', 4, 'cancelled'));
    expect(getFinishingEdit(reply)?.getId()).toBe('$stopped');
    // The newest edit, whoever sent it; the rows keep to their sender's.
    expect(getSyncedEdit('$reply')?.getId()).toBe('$stopped');
  });
});

describe('the copy of a finishing edit the client counts by', () => {
  const decrypted = async (event: MatrixEvent) => {
    await event.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: { type: 'm.room.message', content: { msgtype: 'm.text', body: 'done' } },
      }),
    } as never);
    return event;
  };

  it('is the newest edit, and of two copies of one edit the one the client can read', async () => {
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => null,
    }) as unknown as MatrixClient;
    keepSyncedEdits(mx);
    const withBundle = new MatrixEvent({ ...reply.event });
    // The server's copy bundled with the reply stays encrypted; the sync's copy decrypts.
    withBundle.makeReplaced(edit('$done', 5, 'completed'));
    const synced = edit('$done', 5, 'completed');
    mx.emit(ClientEvent.Event, synced);
    await decrypted(synced);
    expect(getFinishingEdit(withBundle)).toBe(synced);

    // A newer finishing edit wins, readable or not.
    const later = edit('$later', 6, 'completed');
    withBundle.makeReplaced(later);
    expect(getFinishingEdit(withBundle)).toBe(later);
  });
});

describe('a redacted edit the client kept', () => {
  it('no longer says whether the reply still streams', () => {
    const room = { redactedBundledEdits: new Set<string>() };
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => room,
    }) as unknown as MatrixClient;
    keepSyncedEdits(mx);
    mx.emit(ClientEvent.Event, edit('$streaming', 2, 'streaming'));
    expect(isStreamingByServer(reply)).toBe(true);

    // The room takes a redaction of the edit, which it knew only from the reply's bundle.
    room.redactedBundledEdits.add('$streaming');

    expect(getSyncedEdit('$reply')).toBeUndefined();
    expect(isStreamingByServer(reply)).toBeUndefined();
  });

  it('stays forgotten once the account forgets the room and joins it again', () => {
    let room = { redactedBundledEdits: new Set<string>() };
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => room,
    }) as unknown as MatrixClient;
    keepSyncedEdits(mx);
    mx.emit(ClientEvent.Event, edit('$streaming', 2, 'streaming'));
    // The redaction comes with the sync, and the room takes it.
    room.redactedBundledEdits.add('$streaming');
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        type: 'm.room.redaction',
        event_id: '$redaction',
        room_id: '!room:example.org',
        sender: AGENT,
        origin_server_ts: 3,
        redacts: '$streaming',
        content: { redacts: '$streaming' },
      })
    );

    // Forgetting the room drops it with its record; joining it again brings a new room.
    mx.emit(ClientEvent.DeleteRoom, '!room:example.org');
    room = { redactedBundledEdits: new Set<string>() };

    expect(getSyncedEdit('$reply')).toBeUndefined();
  });
});

// Regression (P3-webkit-cards-F004): the agent redacted the edit that finished its streamed reply.
// The reply went back to the edit before, which says it streams, and the card of every device that
// had watched it read "streaming" until a reload.
describe('a finishing edit that is redacted', () => {
  const plain = (eventId: string, ts: number, content: Record<string, unknown>) =>
    new MatrixEvent({
      type: 'm.room.message',
      event_id: eventId,
      room_id: '!room:example.org',
      sender: AGENT,
      origin_server_ts: ts,
      content,
    });
  const streamedEdit = (eventId: string, ts: number, status: string) =>
    plain(eventId, ts, {
      msgtype: 'm.text',
      body: `* ${eventId}`,
      'm.new_content': { msgtype: 'm.text', body: eventId, 'io.mindroom.stream_status': status },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$streamed' },
      'io.mindroom.stream_status': status,
    });
  const timelineSet = {
    relations: { getChildEventsForEvent: () => undefined },
  } as unknown as Parameters<typeof isEventStreaming>[2];

  it('leaves the reply finished, until a newer revision streams', () => {
    const room = { redactedBundledEdits: new Set<string>() };
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => room,
    }) as unknown as MatrixClient;
    keepSyncedEdits(mx);
    const reply = plain('$streamed', 1, {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    });
    const middle = streamedEdit('$middle', 2, 'streaming');
    const finish = streamedEdit('$finish', 3, 'completed');
    [middle, finish].forEach((edit) => mx.emit(ClientEvent.Event, edit));
    reply.makeReplaced(finish);
    expect(isEventStreaming(reply, undefined, timelineSet)).toBe(false);

    // The redaction strips the finishing edit, and the reply shows the edit before it again.
    finish.makeRedacted(
      plain('$redaction', 4, { redacts: '$finish' }),
      {} as Parameters<MatrixEvent['makeRedacted']>[1]
    );
    reply.makeReplaced(middle);
    expect(getFinishingEdit(reply)).toBeUndefined();
    expect(isEventStreaming(reply, undefined, timelineSet)).toBe(false);

    // A revision after the finish streams again.
    const resumed = streamedEdit('$resumed', 5, 'streaming');
    mx.emit(ClientEvent.Event, resumed);
    reply.makeReplaced(resumed);
    expect(isEventStreaming(reply, undefined, timelineSet)).toBe(true);
  });
});
