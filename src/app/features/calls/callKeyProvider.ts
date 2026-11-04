import { BaseKeyProvider, createKeyMaterialFromBuffer } from 'livekit-client';

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
    const raw = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
    const material = await createKeyMaterialFromBuffer(raw);
    this.onSetEncryptionKey(material, participantIdentity, keyIndex);
  }
}
