import { createClient, EventStatus, MatrixEvent, PendingEventOrdering, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';

// A voice message is sent under one transaction ID on every attempt, so the server posts it once
// however often it is retried. The SDK kept the ID of a cancelled local echo and refused a second
// echo under it; our SDK patch gives the ID back when the echo is cancelled.

const ROOM = '!room:example.org';
const USER = '@author:example.org';

const echo = (txnId: string) => {
  const event = new MatrixEvent({
    type: 'm.room.message',
    content: { msgtype: 'm.audio', body: 'Voice message' },
    event_id: `~${ROOM}:${txnId}:${Math.random()}`,
    sender: USER,
    room_id: ROOM,
    origin_server_ts: 1,
  });
  event.setTxnId(txnId);
  event.setStatus(EventStatus.SENDING);
  return event;
};

describe('a cancelled local echo', () => {
  it.each([PendingEventOrdering.Chronological, PendingEventOrdering.Detached])(
    'gives its transaction ID back, so the event is sent again under it (%s)',
    (pendingEventOrdering) => {
      const mx = createClient({ baseUrl: 'https://example.org', userId: USER });
      const room = new Room(ROOM, mx, USER, { pendingEventOrdering });
      mx.store.storeRoom(room);

      const first = echo('voice-txn');
      room.addPendingEvent(first, 'voice-txn');
      room.updatePendingEvent(first, EventStatus.NOT_SENT);
      mx.cancelPendingEvent(first);
      expect(room.getEventForTxnId('voice-txn')).toBeUndefined();

      const second = echo('voice-txn');
      expect(() => room.addPendingEvent(second, 'voice-txn')).not.toThrow();
      expect(room.getEventForTxnId('voice-txn')).toBe(second);
    }
  );
});
