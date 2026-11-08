import type { MatrixClient } from 'matrix-js-sdk';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';
import { fetchKeyBackupVersion } from './keyBackupVersion';
import { CRYPTO_NOT_FOUND } from './unlockWithRecoveryKey';

// Thrown in English and translated when shown, so a retained error follows language changes.
export const BACKUP_ALREADY_EXISTS = 'The account already has a key backup.';
export const BACKUP_NOT_IN_USE = 'The new key backup is not in use.';

/**
 * Gives an account that has secret storage but no key backup a backup: the SDK creates a new
 * backup version signed by this session, stores its decryption key in secret storage under the
 * key the recovery password gives (cached here first, or the SDK could not write it), and starts
 * uploading every room key this session holds. Every session that unlocks with the recovery
 * password then uses the same backup. The SDK's reset deletes older backup versions, so this
 * refuses when the server already has one. It reports success only once the recovery password
 * opens the server's backup.
 */
export async function turnOnKeyBackup(
  client: Pick<MatrixClient, 'getCrypto' | 'http'>,
  keyId: string,
  secretStorageKey: Uint8Array
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);
  if ((await fetchKeyBackupVersion(client)) !== null) throw new Error(BACKUP_ALREADY_EXISTS);
  storePrivateKey(keyId, secretStorageKey);
  await crypto.resetKeyBackup();
  await crypto.checkKeyBackupAndEnable();
  // Keys this session uploaded to an earlier backup, since deleted, still count as backed up, and
  // the SDK forgets that only when its active backup is turned off. So the first new version is
  // made active, deleted (which turns it off) and made again: every key then goes into the backup.
  const first = await crypto.getActiveSessionBackupVersion();
  if (first) {
    await crypto.deleteKeyBackupVersion(first);
    await crypto.resetKeyBackup();
    await crypto.checkKeyBackupAndEnable();
  }
  // The key in secret storage has to open the server's backup (the SDK refuses a stored key that
  // does not match it).
  await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => {
    throw new Error(BACKUP_NOT_IN_USE);
  });
}
