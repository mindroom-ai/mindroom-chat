import * as RustSdkCryptoJs from '@matrix-org/matrix-sdk-crypto-wasm';
import { EventType, MatrixEvent } from 'matrix-js-sdk';
import { RoomEncryptor } from 'matrix-js-sdk/lib/rust-crypto/RoomEncryptor';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type EncryptEventInner = (logger: { debug: () => void }, event: MatrixEvent) => Promise<void>;

const encrypt = async (event: MatrixEvent): Promise<Record<string, unknown>> => {
  const encryptRoomEvent = vi.fn(async () =>
    JSON.stringify({
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      'm.relates_to': { rel_type: 'm.reference', event_id: '$membership' },
    })
  );
  const encryptStateEvent = vi.fn(async () =>
    JSON.stringify({
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque-state',
    })
  );
  const encryptor = {
    room: { roomId: '!dm:example.org' },
    olmMachine: {
      encryptRoomEvent,
      encryptStateEvent,
      identityKeys: {
        curve25519: { toBase64: () => 'curve-key' },
        ed25519: { toBase64: () => 'ed-key' },
      },
    },
  };
  const fn = (RoomEncryptor.prototype as unknown as { encryptEventInner: EncryptEventInner })
    .encryptEventInner;
  await fn.call(encryptor, { debug: vi.fn() }, event);
  return event.getWireContent() as Record<string, unknown>;
};

describe('RoomEncryptor cleartext ring hint patch', () => {
  beforeAll(async () => {
    await RustSdkCryptoJs.initAsync();
  });

  it('adds only the allowlisted hint fields for a non-state ring notification', async () => {
    const event = new MatrixEvent({
      type: EventType.RTCNotification,
      room_id: '!dm:example.org',
      sender: '@alice:example.org',
      content: {
        notification_type: 'ring',
        sender_ts: 1_795_300_000_000,
        lifetime: 30_000,
        'm.call.intent': 'video',
        'm.mentions': { user_ids: ['@bob:example.org'], room: true },
        slot_id: 'm.call#!dm:example.org',
        extra_secret: 'must-not-leak',
      },
    });

    const wire = await encrypt(event);

    expect(event.getWireType()).toBe(EventType.RoomMessageEncrypted);
    expect(wire['io.mindroom.rtc.notification']).toEqual({
      notification_type: 'ring',
      sender_ts: 1_795_300_000_000,
      lifetime: 30_000,
      'm.call.intent': 'video',
    });
    expect(JSON.stringify(wire)).not.toContain('@bob:example.org');
    expect(JSON.stringify(wire)).not.toContain('must-not-leak');
    expect(JSON.stringify(wire)).not.toContain('slot_id');
  });

  it('drops non-integer timestamps/lifetimes and unknown call intents from the hint', async () => {
    const event = new MatrixEvent({
      type: EventType.RTCNotification,
      room_id: '!dm:example.org',
      sender: '@alice:example.org',
      content: {
        notification_type: 'ring',
        sender_ts: 123.45,
        lifetime: '30000',
        'm.call.intent': 'screen',
      },
    });

    const wire = await encrypt(event);

    expect(wire['io.mindroom.rtc.notification']).toEqual({
      notification_type: 'ring',
    });
  });

  it('does not add a hint for group notifications, state events, or ordinary messages', async () => {
    const groupNote = new MatrixEvent({
      type: EventType.RTCNotification,
      room_id: '!group:example.org',
      sender: '@alice:example.org',
      content: {
        notification_type: 'notification',
        sender_ts: 1_795_300_000_000,
        lifetime: 30_000,
        'm.call.intent': 'audio',
      },
    });
    const stateRing = new MatrixEvent({
      type: EventType.RTCNotification,
      state_key: '',
      room_id: '!dm:example.org',
      sender: '@alice:example.org',
      content: {
        notification_type: 'ring',
        sender_ts: 1_795_300_000_000,
        lifetime: 30_000,
        'm.call.intent': 'audio',
      },
    });
    const message = new MatrixEvent({
      type: EventType.RoomMessage,
      room_id: '!dm:example.org',
      sender: '@alice:example.org',
      content: { msgtype: 'm.text', body: 'hello' },
    });

    expect((await encrypt(groupNote))['io.mindroom.rtc.notification']).toBeUndefined();
    expect((await encrypt(stateRing))['io.mindroom.rtc.notification']).toBeUndefined();
    expect((await encrypt(message))['io.mindroom.rtc.notification']).toBeUndefined();
  });
});
