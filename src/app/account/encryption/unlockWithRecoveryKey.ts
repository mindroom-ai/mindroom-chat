import type { MatrixClient } from 'matrix-js-sdk';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';

// Thrown in English and translated when shown, so a retained error follows language changes.
export const CRYPTO_NOT_FOUND = 'Unexpected Error! Crypto object not found.';
export const NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE =
  'Secret storage holds no cross-signing keys to verify this session with.';

/**
 * Caches the recovery key, then lets the SDK unlock cross-signing and key backup with it: it
 * imports the account's cross-signing keys from secret storage and signs this device with them.
 *
 * Only when secret storage holds those keys. Without them the SDK's bootstrap creates new ones,
 * writes them into secret storage before publishing them, and then fails to publish because the
 * server asks for the password. Secret storage would be left with keys nobody published, and the
 * recovery key would stop verifying every other session.
 */
/**
 * Asks the server for the account's own cross-signing identity again. A publish that failed leaves
 * this session holding new keys the server never got, and a session can lag behind a reset made
 * elsewhere; the fresh answer replaces both views (the SDK drops local private keys that do not
 * match the published identity). A failed request leaves things as they were.
 */
export const refreshOwnIdentity = async (
  client: Pick<MatrixClient, 'getCrypto' | 'getSafeUserId'>
): Promise<void> => {
  try {
    await client.getCrypto()?.userHasCrossSigningKeys(client.getSafeUserId(), true);
  } catch {
    // Callers go on with what they know; after a failure, the original error matters more.
  }
};

export async function unlockWithRecoveryKey(
  client: Pick<MatrixClient, 'getCrypto' | 'getSafeUserId'>,
  keyId: string,
  recoveryKey: Uint8Array
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);
  // Compared with what the server publishes now, so stale keys of this session cannot pass for
  // the account's and a stale view cannot make healthy secret storage look mismatched.
  await refreshOwnIdentity(client);
  const { privateKeysInSecretStorage } = await crypto.getCrossSigningStatus();
  if (!privateKeysInSecretStorage) throw new Error(NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE);
  storePrivateKey(keyId, recoveryKey);
  await crypto.bootstrapCrossSigning({});
  await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => undefined);
  await crypto.checkKeyBackupAndEnable();
}
