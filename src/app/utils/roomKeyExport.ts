/**
 * Passphrase-protected room key files (Matrix client-server spec, "Key exports"): the exported
 * sessions as JSON, encrypted with AES-256-CTR under a key derived with PBKDF2-HMAC-SHA-512, and
 * authenticated with HMAC-SHA-256, between the armor lines below. Other Matrix clients read and
 * write the same files.
 */

const ARMOR_BEGIN = '-----BEGIN MEGOLM SESSION DATA-----';
const ARMOR_END = '-----END MEGOLM SESSION DATA-----';
const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 16;
const ROUNDS_BYTES = 4;
const MAC_BYTES = 32;
const HEADER_BYTES = 1 + SALT_BYTES + IV_BYTES + ROUNDS_BYTES;
/** The spec asks for at least 100,000 rounds. */
export const DEFAULT_EXPORT_ROUNDS = 500_000;
const LINE_LENGTH = 76;

/** Thrown when a file is not a key export or its passphrase is wrong. */
export class RoomKeyExportError extends Error {
  constructor(readonly reason: 'format' | 'passphrase') {
    super(reason === 'format' ? 'Not a room key export file' : 'Wrong passphrase');
    this.name = 'RoomKeyExportError';
  }
}

const encoder = new TextEncoder();

/** AES key K and HMAC key K' from the first and last 256 of 512 derived bits. */
const deriveKeys = async (passphrase: string, salt: Uint8Array, rounds: number) => {
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: rounds },
      material,
      512
    )
  );
  const [aesKey, macKey] = await Promise.all([
    subtle.importKey('raw', bits.slice(0, 32), 'AES-CTR', false, ['encrypt', 'decrypt']),
    subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]),
  ]);
  return { aesKey, macKey };
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** Encrypts the JSON from `exportRoomKeysAsJson` into the armored file text. */
export const encryptRoomKeyExport = async (
  json: string,
  passphrase: string,
  rounds = DEFAULT_EXPORT_ROUNDS
): Promise<string> => {
  const { subtle } = globalThis.crypto;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // The low 64 bits count blocks; clearing their top bit keeps the counter from wrapping.
  iv[8] &= 0x7f;
  const { aesKey, macKey } = await deriveKeys(passphrase, salt, rounds);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-CTR', counter: iv, length: 64 }, aesKey, encoder.encode(json))
  );

  const body = new Uint8Array(HEADER_BYTES + ciphertext.length + MAC_BYTES);
  const view = new DataView(body.buffer);
  body[0] = FORMAT_VERSION;
  body.set(salt, 1);
  body.set(iv, 1 + SALT_BYTES);
  view.setUint32(1 + SALT_BYTES + IV_BYTES, rounds);
  body.set(ciphertext, HEADER_BYTES);
  const signed = body.subarray(0, HEADER_BYTES + ciphertext.length);
  body.set(new Uint8Array(await subtle.sign('HMAC', macKey, signed)), signed.length);

  const encoded = toBase64(body);
  const lines: string[] = [];
  for (let start = 0; start < encoded.length; start += LINE_LENGTH) {
    lines.push(encoded.slice(start, start + LINE_LENGTH));
  }
  return [ARMOR_BEGIN, ...lines, ARMOR_END, ''].join('\n');
};

/** The binary payload between the armor lines of a key export file. */
const readArmoredPayload = (file: string): Uint8Array => {
  const lines = file.split(/\r?\n/).map((line) => line.trim());
  const begin = lines.indexOf(ARMOR_BEGIN);
  const end = lines.indexOf(ARMOR_END, begin + 1);
  if (begin < 0 || end < 0) throw new RoomKeyExportError('format');
  try {
    return fromBase64(lines.slice(begin + 1, end).join(''));
  } catch {
    throw new RoomKeyExportError('format');
  }
};

/** Checks and decrypts an armored key export, returning the JSON for `importRoomKeysAsJson`. */
export const decryptRoomKeyExport = async (file: string, passphrase: string): Promise<string> => {
  const { subtle } = globalThis.crypto;
  const body = readArmoredPayload(file);
  if (body.length < HEADER_BYTES + MAC_BYTES || body[0] !== FORMAT_VERSION) {
    throw new RoomKeyExportError('format');
  }
  const salt = body.slice(1, 1 + SALT_BYTES);
  const iv = body.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES);
  const rounds = new DataView(body.buffer, body.byteOffset).getUint32(1 + SALT_BYTES + IV_BYTES);
  const macStart = body.length - MAC_BYTES;
  const { aesKey, macKey } = await deriveKeys(passphrase, salt, rounds);

  const authentic = await subtle.verify(
    'HMAC',
    macKey,
    body.slice(macStart),
    body.slice(0, macStart)
  );
  if (!authentic) throw new RoomKeyExportError('passphrase');
  const plaintext = await subtle.decrypt(
    { name: 'AES-CTR', counter: iv, length: 64 },
    aesKey,
    body.slice(HEADER_BYTES, macStart)
  );
  return new TextDecoder().decode(plaintext);
};
