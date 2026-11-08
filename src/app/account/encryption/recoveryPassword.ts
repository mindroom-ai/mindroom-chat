import type { MatrixClient, UIAuthCallback } from 'matrix-js-sdk';
import type {
  CreateSecretStorageOpts,
  CryptoApi,
  GeneratedSecretStorageKey,
} from 'matrix-js-sdk/lib/crypto-api';
import { clearSecretStorageKeys } from '../../matrix/client/secretStorageKeys';
import { fetchKeyBackupVersion } from './keyBackupVersion';

// Thrown in English and translated when shown, so a retained error follows language changes.
export const CRYPTO_NOT_FOUND = 'Unexpected Error! Crypto module not found!';
export const RECOVERY_KEY_FAILED = 'Unexpected Error! Failed to create recovery key.';
export const RECOVERY_SECRETS_NOT_CACHED =
  'This session does not hold every encryption key. Verify it with your recovery password or another device, then try again.';
export const SECRET_STORAGE_INCOMPLETE =
  'The new recovery password does not cover every encryption key.';

// Both the secret storage and its key backup are created anew, never merged into existing ones.
const FRESH_SECRET_STORAGE = { setupNewSecretStorage: true, setupNewKeyBackup: true } as const;

/**
 * Creates new secret storage, key backup and cross-signing keys, with the secret storage key
 * derived from `password`. Resolves to the encoded recovery key.
 */
export const setUpRecovery = async (
  client: Pick<MatrixClient, 'getCrypto'>,
  password: string,
  authUploadDeviceSigningKeys: UIAuthCallback<void>
): Promise<string> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);

  const recoveryKey = await crypto.createRecoveryKeyFromPassphrase(password);
  const { encodedPrivateKey } = recoveryKey;
  if (!encodedPrivateKey) throw new Error(RECOVERY_KEY_FAILED);

  // The new secret storage comes first. New cross-signing keys are written into the
  // account's secret storage, and a reset is for people who no longer have the old
  // storage's key, so they go into the new one, whose key is cached as it is created.
  // Keys cached for the previous secret storage cannot open the new one.
  const freshStorage: CreateSecretStorageOpts = {
    createSecretStorageKey: () => Promise.resolve(recoveryKey),
    ...FRESH_SECRET_STORAGE,
  };
  clearSecretStorageKeys();
  await crypto.bootstrapSecretStorage(freshStorage);
  // The SDK writes the new cross-signing keys into the storage made above.
  const newIdentity = { setupNewCrossSigning: true, authUploadDeviceSigningKeys };
  await crypto.bootstrapCrossSigning(newIdentity);
  return encodedPrivateKey;
};

/**
 * Whether this session holds the decryption key of the account's key backup, or the account has
 * none. The SDK writes the key into new secret storage only when it matches its own copy of the
 * backup's info, and skips it without a word otherwise, so that copy has to be the server's
 * current backup (another session may have replaced it) and the key has to match it.
 */
const holdsBackupKey = async (
  client: Pick<MatrixClient, 'http'>,
  crypto: CryptoApi
): Promise<boolean> => {
  const onServer = await fetchKeyBackupVersion(client);
  if (onServer === null) return true;
  const known = await crypto.getKeyBackupInfo();
  if (!known || known.version !== onServer.version) return false;
  return (await crypto.isKeyBackupTrusted(known)).matchesDecryptionKey;
};

/**
 * Stores the cross-signing keys and the backup key this session holds under a new secret
 * storage key, so a changed recovery password covers them without new keys or a new backup.
 * Refuses, before touching anything, when this session lacks any of them.
 */
export const storeSecretsUnderNewKey = async (
  client: Pick<MatrixClient, 'getCrypto' | 'http'>,
  recoveryKey: GeneratedSecretStorageKey
): Promise<void> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);

  const { privateKeysCachedLocally } = await crypto.getCrossSigningStatus();
  const crossSigningCached =
    privateKeysCachedLocally.masterKey &&
    privateKeysCachedLocally.selfSigningKey &&
    privateKeysCachedLocally.userSigningKey;
  if (!crossSigningCached || !(await holdsBackupKey(client, crypto))) {
    throw new Error(RECOVERY_SECRETS_NOT_CACHED);
  }

  // No `setupNewKeyBackup`: the SDK writes the backup key it holds into the new storage.
  const replacement: CreateSecretStorageOpts = {
    createSecretStorageKey: () => Promise.resolve(recoveryKey),
    setupNewSecretStorage: true,
  };
  // Keys cached for the previous secret storage cannot open the new one.
  clearSecretStorageKeys();
  await crypto.bootstrapSecretStorage(replacement);
  if (!(await crypto.getSecretStorageStatus()).ready) throw new Error(SECRET_STORAGE_INCOMPLETE);
};
