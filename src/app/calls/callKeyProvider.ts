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
 * that device or sent.
 *
 * matrix-js-sdk's `encryptAndSendToDevice` would resolve without sending anything for a device its
 * crypto does not know (it only logs a warning), and it hands the message to a send queue whose
 * failures never reach the caller, so `RoomCall` could not tell that the key did not go and would
 * not send it again. Here the key is encrypted and sent directly. When the encrypted batch lacks
 * the device, an untracked user is tracked and their key query awaited once; when the device is
 * still missing, or the send fails, the promise rejects.
 */
export const sendCallKey = async (
  mx: MatrixClient,
  { roomId, key, keyIndex, memberId, to }: CallKeyDelivery
): Promise<void> => {
  const cryptoApi = mx.getCrypto();
  if (!cryptoApi) throw new Error('No crypto to encrypt a call key with');
  const payload = {
    keys: { index: keyIndex, key: encodeBase64(key) },
    room_id: roomId,
    member: { claimed_device_id: mx.getDeviceId() ?? '', id: memberId },
    session: { call_id: '', application: 'm.call', scope: 'm.room' },
    sent_ts: Date.now(),
  };
  const encrypt = async () => {
    const { eventType, batch } = await cryptoApi.encryptToDeviceMessages(
      EventType.CallEncryptionKeysPrefix,
      [{ userId: to.userId, deviceId: to.deviceId }],
      payload
    );
    const message = batch.find((m) => m.userId === to.userId && m.deviceId === to.deviceId);
    return message && { eventType, content: message.payload };
  };

  let encrypted = await encrypt();
  if (!encrypted) {
    // Tracks an untracked user and awaits their key query through the Rust crypto
    // (patches/matrix-js-sdk+41.7.0.patch); a tracked user's cached list is kept as it is.
    await cryptoApi.getUserDeviceInfo([to.userId], true);
    encrypted = await encrypt();
  }
  if (!encrypted) throw new Error(`No known device ${to.deviceId} of ${to.userId} for a call key`);
  await mx.sendToDevice(
    encrypted.eventType,
    new Map([[to.userId, new Map([[to.deviceId, encrypted.content]])]])
  );
};
