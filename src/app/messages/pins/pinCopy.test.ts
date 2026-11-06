import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getLoadedDecryptedEvent } from './pinContent';

const ROOM_ID = '!terminal:example.org';

const encrypted = () =>
  new MatrixEvent({
    event_id: '$reply',
    room_id: ROOM_ID,
    sender: '@coordinator:example.org',
    origin_server_ts: 1,
    type: 'm.room.encrypted',
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'sealed' },
  });

/** A room whose timeline holds `copy`. */
const roomHolding = (copy: MatrixEvent) => {
  const timelineSet = { relations: {} };
  return {
    room: {
      getTimelineForEvent: () => ({
        getEvents: () => [copy],
        getTimelineSet: () => timelineSet,
      }),
    } as unknown as Room,
    timelineSet,
  };
};

describe('getLoadedDecryptedEvent', () => {
  it('gives the timeline copy of an encrypted pin when that copy is decrypted', () => {
    const copy = new MatrixEvent({
      event_id: '$reply',
      room_id: ROOM_ID,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Reefer row C lost power twice before midnight.' },
    });
    const { room, timelineSet } = roomHolding(copy);
    expect(getLoadedDecryptedEvent(room, encrypted())).toEqual({ event: copy, timelineSet });
  });

  it('gives nothing when the timeline copy is not decrypted either', () => {
    const copy = encrypted();
    expect(getLoadedDecryptedEvent(roomHolding(copy).room, copy)).toBeUndefined();
  });
});
