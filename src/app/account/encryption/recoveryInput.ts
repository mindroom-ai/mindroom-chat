import type { MatrixClient } from 'matrix-js-sdk';
import type { SecretStorageKeyDescriptionAesV1 } from 'matrix-js-sdk/lib/secret-storage';
import { decodeRecoveryKey, deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api';

/** `m.secret_storage.key.*` passphrase info (PBKDF2 settings). */
export type SecretStoragePassphraseContent = {
  algorithm: string;
  iterations: number;
  salt: string;
  /** Length of the derived key; the spec default is 256. */
  bits?: number;
};

/**
 * The content of an `m.secret_storage.key.<id>` account data event (spec: "Key storage"). Every
 * field is optional because the event comes from the server unchecked.
 */
export type SecretStorageKeyContent = {
  algorithm?: string;
  name?: string;
  iv?: string;
  mac?: string;
  passphrase?: SecretStoragePassphraseContent;
};

// Thrown in English and translated when shown, so a retained error follows language changes.
export const INVALID_RECOVERY_INPUT = 'Invalid recovery password or key.';

/** A recovery key, or null when `text` is not one (any whitespace is allowed inside the key). */
const decodeKey = (text: string): Uint8Array | null => {
  try {
    return decodeRecoveryKey(text.replace(/\s/g, ''));
  } catch {
    return null;
  }
};

/**
 * Turns what a person typed into the secret storage key it stands for: a base58 recovery key, or
 * else the password the key's passphrase info derives it from (also when the text reads as a
 * recovery key that does not fit, since any text can be chosen as the password). The key is
 * checked against the key description; anything that does not match rejects with
 * `INVALID_RECOVERY_INPUT`.
 */
export const keyFromRecoveryInput = async (
  client: Pick<MatrixClient, 'secretStorage'>,
  input: string,
  keyContent: SecretStorageKeyContent
): Promise<Uint8Array> => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error(INVALID_RECOVERY_INPUT);
  const description = keyContent as SecretStorageKeyDescriptionAesV1;
  const decoded = decodeKey(trimmed);
  if (decoded && (await client.secretStorage.checkKey(decoded, description))) return decoded;
  if (keyContent.passphrase) {
    const { salt, iterations, bits } = keyContent.passphrase;
    const derived = await deriveRecoveryKeyFromPassphrase(trimmed, salt, iterations, bits);
    if (await client.secretStorage.checkKey(derived, description)) return derived;
  }
  throw new Error(INVALID_RECOVERY_INPUT);
};
