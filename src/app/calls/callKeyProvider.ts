import { BaseKeyProvider, createKeyMaterialFromBuffer } from 'livekit-client';
import { EventType, type MatrixClient } from 'matrix-js-sdk';
import { encodeBase64 } from 'matrix-js-sdk/lib/base64';

/**
 * Media frame keys of a MatrixRTC call. Every participant encrypts its media with its own key and
 * sends it to the others over Olm (`io.element.call.encryption_keys`); matrix-js-sdk's session
 * hands each key here with its index (0-255) and the participant's media identity.
 *
 * The settings match the other MatrixRTC participants, MindRoom agents among them: a keyring of
 * 256 so every index keeps its key, a ratchet window of 10, and HKDF key derivation from the raw
 * 16-byte keys (LiveKit's derivation for binary key material).
 */
export class MatrixRtcKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ ratchetWindowSize: 10, keyringSize: 256 });
  }

  async setParticipantKey(key: Uint8Array, keyIndex: number, participantIdentity: string) {
    const raw = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength);
    const material = await createKeyMaterialFromBuffer(raw);
    this.onSetEncryptionKey(material, participantIdentity, keyIndex);
  }
}

export type CallKeyDelivery = {
  roomId: string;
  key: Uint8Array;
  keyIndex: number;
  /** This device's media identity in the call, `<user id>:<device id>`. */
  memberId: string;
  to: { userId: string; deviceId: string };
};

/**
 * Sends this device's media key of a call to one other device over Olm, in the to-device event
 * matrix-js-sdk's MatrixRTC session sends it in. Rejects when the key could not be encrypted for
 * that device or queued for sending.
 */
export const sendCallKey = (
  mx: MatrixClient,
  { roomId, key, keyIndex, memberId, to }: CallKeyDelivery
): Promise<void> =>
  mx.encryptAndSendToDevice(
    EventType.CallEncryptionKeysPrefix,
    [{ userId: to.userId, deviceId: to.deviceId }],
    {
      keys: { index: keyIndex, key: encodeBase64(key) },
      room_id: roomId,
      member: { claimed_device_id: mx.getDeviceId() ?? '', id: memberId },
      session: { call_id: '', application: 'm.call', scope: 'm.room' },
      sent_ts: Date.now(),
    }
  );
