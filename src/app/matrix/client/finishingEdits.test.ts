import { ClientEvent, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { getFinishingEdit, keepFinishingEdits } from './finishingEdits';

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
    const mx = new EventEmitter() as unknown as MatrixClient;
    keepFinishingEdits(mx);
    expect(getFinishingEdit(mx, reply)).toBeUndefined();

    mx.emit(ClientEvent.Event, edit('$streaming', 2, 'streaming'));
    expect(getFinishingEdit(mx, reply)).toBeUndefined();

    // Only the reply's sender can finish it.
    mx.emit(ClientEvent.Event, edit('$forged', 3, 'completed', '@someone:example.org'));
    expect(getFinishingEdit(mx, reply)).toBeUndefined();

    mx.emit(ClientEvent.Event, edit('$stopped', 4, 'cancelled'));
    expect(getFinishingEdit(mx, reply)?.getId()).toBe('$stopped');
  });
});
