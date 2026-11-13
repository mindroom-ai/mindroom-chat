import { describe, expect, it } from 'vitest';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { isRenderableEvent } from './roomTimelineEvents';

describe('isRenderableEvent', () => {
  it('never shows a reference, such as an encrypted copy of a canvas state not decrypted yet', () => {
    const encryptedCopy = new MatrixEvent({
      type: 'm.room.encrypted',
      event_id: '$copy',
      room_id: '!room:server',
      sender: '@alice:server',
      origin_server_ts: 1,
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'secret',
        'm.relates_to': { rel_type: 'm.reference', event_id: '$canvas' },
      },
    });
    const room = {} as Room;
    expect(isRenderableEvent(encryptedCopy, room, undefined, new Set(), false, false, false)).toBe(
      false
    );
    expect(isRenderableEvent(encryptedCopy, room, undefined, new Set(), true, false, false)).toBe(
      true
    );
  });

  it('shows a message that carries a reference, but not a reference that cannot be decrypted', async () => {
    const reference = { rel_type: 'm.reference', event_id: '$target' };
    const message = new MatrixEvent({
      type: 'm.room.message',
      event_id: '$message',
      room_id: '!room:server',
      sender: '@bob:server',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'hello', 'm.relates_to': reference },
    });
    const unreadable = new MatrixEvent({
      type: 'm.room.encrypted',
      event_id: '$unreadable',
      room_id: '!room:server',
      sender: '@bob:server',
      origin_server_ts: 2,
      content: { ciphertext: 'secret', 'm.relates_to': reference },
    });
    await unreadable.attemptDecryption({
      decryptEvent: async () => {
        throw new Error('missing key');
      },
    } as never);
    const room = {} as Room;
    expect(isRenderableEvent(message, room, undefined, new Set(), false, false, false)).toBe(true);
    expect(isRenderableEvent(unreadable, room, undefined, new Set(), false, false, false)).toBe(
      false
    );
  });
});
