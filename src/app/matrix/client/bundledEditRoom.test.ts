import { createClient, type IEvent, type MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { keepBundledEditsInTheirRoom } from './bundledEditRoom';

const ROOM_ID = '!room:example.org';
const SENDER = '@bob:example.org';

/** An encrypted message from a /sync timeline, with its encrypted edit bundled as servers send it. */
const syncedMessageWithBundledEdit = (): Partial<IEvent> => ({
  event_id: '$message',
  room_id: ROOM_ID,
  sender: SENDER,
  type: 'm.room.encrypted',
  origin_server_ts: 1,
  content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'message' },
  unsigned: {
    'm.relations': {
      'm.replace': {
        // The /sync format has no room ID, here or in the bundle.
        event_id: '$edit',
        sender: SENDER,
        type: 'm.room.encrypted',
        origin_server_ts: 2,
        content: {
          algorithm: 'm.megolm.v1.aes-sha2',
          ciphertext: 'edit',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$message' },
        },
      },
    },
  },
});

/** A client whose decryption only records the room ID each event had when it was asked. */
const recordingClient = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  const decrypted: Array<[string | undefined, string | null]> = [];
  mx.decryptEventIfNeeded = async (event: MatrixEvent) => {
    decrypted.push([event.getId(), event.getRoomId() ?? null]);
  };
  return { mx, decrypted };
};

describe('keepBundledEditsInTheirRoom', () => {
  it('without it, the SDK decrypts a bundled edit without a room ID', () => {
    const { mx, decrypted } = recordingClient();

    const message = mx.getEventMapper()(syncedMessageWithBundledEdit());

    expect(message.replacingEvent()?.getRoomId()).toBeUndefined();
    expect(decrypted).toContainEqual(['$edit', null]);
  });

  it('gives a bundled edit the room ID of its event before the SDK decrypts it', () => {
    const { mx, decrypted } = recordingClient();
    keepBundledEditsInTheirRoom(mx);

    const message = mx.getEventMapper()(syncedMessageWithBundledEdit());

    expect(message.replacingEvent()?.getRoomId()).toBe(ROOM_ID);
    expect(decrypted).toEqual([
      ['$edit', ROOM_ID],
      ['$message', ROOM_ID],
    ]);
  });

  it('keeps a room ID the bundle has, and leaves events without a bundle alone', () => {
    const { mx } = recordingClient();
    keepBundledEditsInTheirRoom(mx);
    const raw = syncedMessageWithBundledEdit();
    const bundle = raw.unsigned?.['m.relations']?.['m.replace'] as Partial<IEvent>;
    bundle.room_id = '!other:example.org';
    const plain = { ...raw, event_id: '$plain', unsigned: {} };

    expect(mx.getEventMapper()(raw).replacingEvent()?.getRoomId()).toBe('!other:example.org');
    expect(mx.getEventMapper()(plain).getRoomId()).toBe(ROOM_ID);
  });
});
