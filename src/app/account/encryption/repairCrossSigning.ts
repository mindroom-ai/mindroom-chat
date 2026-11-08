import type { MatrixClient, UIAuthCallback } from 'matrix-js-sdk';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';
import { CRYPTO_NOT_FOUND } from './unlockWithRecoveryKey';

/**
 * How the Rust crypto stack words an import of cross-signing keys from secret storage whose
 * public key is not the one the server holds.
 */
const MISMATCH = /doesn't match the public key that was uploaded to the server/;

/**
 * Whether unlocking failed because secret storage holds another identity than the account's.
 * A reset writes its new cross-signing keys into secret storage before it publishes them, so a
 * publish that never happened (its account password prompt closed, the server refusing it)
 * leaves the recovery password opening keys nobody knows.
 */
export const isCrossSigningMismatch = (error: unknown): boolean =>
  error instanceof Error && MISMATCH.test(error.message);

/**
 * Gives the account a new identity in place of the one secret storage holds and the server never
 * published, keeping what still works: the secret storage key (the recovery password stays) and
 * the key backup, whose decryption key does not depend on the identity. The backup key is loaded
 * first, so the backup stays readable and in use once the new identity is published. Other
 * sessions of the account have to verify again afterwards.
 */
export async function repairCrossSigning(
  client: Pick<MatrixClient, 'getCrypto'>,
  keyId: string,
  secretStorageKey: Uint8Array,
  authUploadDeviceSigningKeys: UIAuthCallback<void>
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);
  storePrivateKey(keyId, secretStorageKey);
  // An account without a backup, or a backup key that no longer matches, has none to keep.
  await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => undefined);
  // The new keys are written under the cached secret storage key, then published.
  await crypto.bootstrapCrossSigning({ setupNewCrossSigning: true, authUploadDeviceSigningKeys });
  await crypto.checkKeyBackupAndEnable();
}
