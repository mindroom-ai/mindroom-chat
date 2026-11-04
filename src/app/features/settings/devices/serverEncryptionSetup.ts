import type { MatrixClient } from 'matrix-js-sdk';
import { fetchKeyBackupVersion } from '../../../utils/keyBackupVersion';

/**
 * Whether the server already holds any part of the account's encryption setup: published
 * cross-signing keys, a default secret storage key, or a key backup. Setting up verification
 * over any of them replaces it, so the caller asks first.
 *
 * Every answer comes from the server at call time. This session's own view is not enough: it
 * learns the account's cross-signing keys from its first `/keys/query`, which may not have
 * finished, or may have failed. Rejects when any of the three cannot be checked, because an
 * unanswered question is not a "no".
 */
export const hasServerEncryptionSetup = async (
  client: Pick<MatrixClient, 'getCrypto' | 'getSafeUserId' | 'secretStorage' | 'http'>
): Promise<boolean> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error('No crypto module to check the encryption setup with');
  const [crossSigning, secretStorageKeyId, backup] = await Promise.all([
    // `true` downloads the keys when this session does not track its own user yet; for a
    // tracked own user the SDK queries the server again either way.
    crypto.userHasCrossSigningKeys(client.getSafeUserId(), true),
    client.secretStorage.getDefaultKeyId(),
    fetchKeyBackupVersion(client),
  ]);
  return crossSigning || secretStorageKeyId !== null || backup !== null;
};
