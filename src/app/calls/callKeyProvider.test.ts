import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { createKeyMaterialFromBuffer } from 'livekit-client';
import { MatrixRtcKeyProvider, sendCallKey, type CallKeyDelivery } from './callKeyProvider';

const agent = { userId: '@agent:test', deviceId: 'AGENTDEVICE' };

const delivery: CallKeyDelivery = {
  roomId: '!call:test',
  key: new Uint8Array([1, 2, 3]),
  keyIndex: 4,
  memberId: '@me:test:MYDEVICE',
  to: agent,
};

/** What `encryptToDeviceMessages` returns when the crypto knows the device, or does not. */
const batchFor = (known: boolean) => ({
  eventType: 'm.room.encrypted',
  batch: known ? [{ ...agent, payload: { ciphertext: 'olm' } }] : [],
});

/** A client whose crypto knows the agent's device on the given encryption attempts. */
const clientKnowing = (...known: boolean[]) => {
  const encryptToDeviceMessages = vi.fn(async () => batchFor(known.shift() ?? false));
  const getUserDeviceInfo = vi.fn(async () => new Map());
  const sendToDevice = vi.fn(async () => ({}));
  const mx = {
    getCrypto: () => ({ encryptToDeviceMessages, getUserDeviceInfo }),
    getDeviceId: () => 'MYDEVICE',
    sendToDevice,
  } as unknown as MatrixClient;
  return { mx, encryptToDeviceMessages, getUserDeviceInfo, sendToDevice };
};

const sentContent = new Map([[agent.userId, new Map([[agent.deviceId, { ciphertext: 'olm' }]])]]);

describe('sendCallKey', () => {
  it('sends the key encrypted for the device straight to the server', async () => {
    const { mx, encryptToDeviceMessages, getUserDeviceInfo, sendToDevice } = clientKnowing(true);

    await sendCallKey(mx, delivery);

    expect(encryptToDeviceMessages).toHaveBeenCalledWith(
      'io.element.call.encryption_keys',
      [agent],
      // What the SDK's first send carries (ToDeviceKeyTransport.sendKey): the fields a peer reads now,
      // and `keys` and `member.id`, which one that reads the older format takes.
      {
        room_id: '!call:test',
        member_id: '@me:test:MYDEVICE',
        media_key: { index: 4, key: 'AQID' },
        keys: { index: 4, key: 'AQID' },
        member: { claimed_device_id: 'MYDEVICE', id: '@me:test:MYDEVICE' },
      }
    );
    expect(getUserDeviceInfo).not.toHaveBeenCalled();
    expect(sendToDevice).toHaveBeenCalledWith('m.room.encrypted', sentContent);
  });

  it('fetches the device list of a device the crypto does not know, then sends', async () => {
    const { mx, getUserDeviceInfo, sendToDevice } = clientKnowing(false, true);

    await sendCallKey(mx, delivery);

    expect(getUserDeviceInfo).toHaveBeenCalledWith([agent.userId], true);
    expect(sendToDevice).toHaveBeenCalledWith('m.room.encrypted', sentContent);
  });

  it('rejects, instead of sending nothing, when the device stays unknown', async () => {
    const { mx, sendToDevice } = clientKnowing(false, false);

    await expect(sendCallKey(mx, delivery)).rejects.toThrow('AGENTDEVICE');
    expect(sendToDevice).not.toHaveBeenCalled();
  });

  it('sends nothing when the batch holds only another device of the user', async () => {
    const { mx, encryptToDeviceMessages, getUserDeviceInfo, sendToDevice } = clientKnowing();
    encryptToDeviceMessages.mockResolvedValue({
      eventType: 'm.room.encrypted',
      batch: [{ userId: agent.userId, deviceId: 'OTHERDEVICE', payload: { ciphertext: 'olm' } }],
    });

    await expect(sendCallKey(mx, delivery)).rejects.toThrow('AGENTDEVICE');
    expect(getUserDeviceInfo).toHaveBeenCalledTimes(1);
    expect(sendToDevice).not.toHaveBeenCalled();
  });

  it('rejects when the server refuses the send', async () => {
    const { mx, sendToDevice } = clientKnowing(true);
    sendToDevice.mockRejectedValueOnce(new Error('M_LIMIT_EXCEEDED'));

    await expect(sendCallKey(mx, delivery)).rejects.toThrow('M_LIMIT_EXCEEDED');
  });

  it('uses an explicit claimedDeviceId for synthetic companion screen keys', async () => {
    const { mx, encryptToDeviceMessages } = clientKnowing(true);

    await sendCallKey(mx, {
      ...delivery,
      memberId: '@alice:example.com:IPHONE-screen',
      claimedDeviceId: 'IPHONE-screen',
    });

    expect(encryptToDeviceMessages).toHaveBeenCalledWith(
      'io.element.call.encryption_keys',
      [agent],
      expect.objectContaining({
        member_id: '@alice:example.com:IPHONE-screen',
        member: { claimed_device_id: 'IPHONE-screen', id: '@alice:example.com:IPHONE-screen' },
      })
    );
  });
});

describe('MatrixRtcKeyProvider', () => {
  it('derives key material from only a Buffer view slice, not its backing pool allocation', async () => {
    const provider = new MatrixRtcKeyProvider();
    const pool = new Uint8Array(64).fill(0xaa);
    const expected = Array.from({ length: 32 }, (_, i) => i + 1);
    pool.set(expected, 8);
    // Node Buffer overrides Uint8Array.prototype.slice to return a view on the same backing buffer.
    const bufferView = Buffer.from(pool.buffer, 8, 32);
    expect(bufferView.buffer.byteLength).toBe(64);
    expect(bufferView.byteOffset).toBe(8);
    expect(bufferView.byteLength).toBe(32);

    const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');
    try {
      await provider.setParticipantKey(bufferView, 2, '@alice:test:DEV');
      expect(importKeySpy).toHaveBeenCalledTimes(1);
      const raw = importKeySpy.mock.calls[0]?.[1];
      expect(raw).toBeInstanceOf(ArrayBuffer);
      if (!(raw instanceof ArrayBuffer)) throw new Error('expected ArrayBuffer');
      expect(Array.from(new Uint8Array(raw))).toEqual(expected);

      const [stored] = provider.getKeys();
      expect(stored).toBeDefined();
      if (!stored) throw new Error('expected stored key');
      expect(stored.participantIdentity).toBe('@alice:test:DEV');
      expect(stored.keyIndex).toBe(2);
      const standalone = await createKeyMaterialFromBuffer(new Uint8Array(expected).buffer);
      const params: HkdfParams = {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(16),
        info: new Uint8Array([1, 2, 3]),
      };
      const [fromView, fromStandalone] = await Promise.all([
        crypto.subtle.deriveBits(params, stored.key, 256),
        crypto.subtle.deriveBits(params, standalone, 256),
      ]);
      expect(new Uint8Array(fromView)).toEqual(new Uint8Array(fromStandalone));
    } finally {
      importKeySpy.mockRestore();
    }
  });
});
