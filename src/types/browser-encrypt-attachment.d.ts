// Types for browser-encrypt-attachment 0.3, which ships none. It encrypts attachments with
// AES-CTR as the Matrix specification's "Sending encrypted attachments" describes.
declare module 'browser-encrypt-attachment' {
  export type EncryptedAttachmentInfo = {
    v: string;
    key: {
      alg: string;
      ext: boolean;
      key_ops: string[];
      kty: string;
      k: string;
    };
    iv: string;
    hashes: {
      sha256: string;
    };
    /** The attachment's MIME type, when the caller records it with the key. */
    mimetype?: string;
  };

  export type EncryptedAttachment = {
    data: ArrayBuffer;
    info: EncryptedAttachmentInfo;
  };

  export function encryptAttachment(
    plaintextBuffer: ArrayBuffer | ArrayBufferView
  ): Promise<EncryptedAttachment>;

  export function decryptAttachment(
    ciphertextBuffer: ArrayBuffer,
    info: {
      key: JsonWebKey;
      iv: string;
      hashes: { sha256: string };
      v?: string;
    }
  ): Promise<ArrayBuffer>;
}
