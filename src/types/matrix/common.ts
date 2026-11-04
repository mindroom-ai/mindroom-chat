// Shapes of Matrix event content shared by message, media and upload code.
// See the client-server specification, "m.room.message msgtypes" and "Sending encrypted attachments".

/**
 * A JSON Web Key for AES-CTR, as carried in encrypted attachment metadata. The specification has
 * senders set `ext` to true, but decryption imports the key without it, so received keys may omit it.
 */
type IEncryptedFileKey = {
  alg: string;
  ext?: boolean;
  key_ops: string[];
  kty: string;
  k: string;
};

/** The `file` object of an encrypted attachment. */
export type IEncryptedFile = {
  url: string;
  mimetype?: string;
  key: IEncryptedFileKey;
  iv: string;
  hashes: {
    sha256: string;
    [algorithm: string]: string;
  };
  v: string;
};

export type IThumbnailInfo = {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
};

export type IImageInfo = IThumbnailInfo & {
  thumbnail_info?: IThumbnailInfo;
  thumbnail_url?: string;
  thumbnail_file?: IEncryptedFile;
  'xyz.amorgan.blurhash'?: string;
};

/** `info` of an `m.video` event: the image fields plus the length in milliseconds. */
export type IVideoInfo = IImageInfo & { duration?: number };

/** `info` of an `m.audio` event. */
export type IAudioInfo = {
  size?: number;
  mimetype?: string;
  duration?: number;
};

/** `info` of an `m.file` event; a file may carry a preview thumbnail. */
export type IFileInfo = IThumbnailContent & {
  mimetype?: string;
  size?: number;
};

/** The thumbnail fields of a media `info` object: a plain URL or an encrypted file. */
export type IThumbnailContent = {
  thumbnail_url?: string;
  thumbnail_file?: IEncryptedFile;
  thumbnail_info?: IThumbnailInfo;
};

/** Duration in milliseconds and a waveform of values from 0 to 1024 (MSC1767 audio). */
export type IMatrixAudioDetails = {
  duration?: number;
  waveform?: number[];
};

// MSC3245 voice messages mark an `m.audio` event with an empty voice object, and MSC1767 adds
// the audio details. Clients send both the stable and the unstable keys.
export const MATRIX_VOICE_MESSAGE_PROPERTY_NAME = 'm.voice';
export const MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME = 'org.matrix.msc3245.voice';
export const MATRIX_AUDIO_DETAILS_PROPERTY_NAME = 'm.audio';
export const MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME = 'org.matrix.msc1767.audio';
