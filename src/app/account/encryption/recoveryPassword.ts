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
 * Creates new cross-signing keys, then new secret storage and key backup, with the secret storage
 * key derived from `password`. Resolves to the encoded recovery key.
 *
 * The identity is published first, and nothing else changes until it is: the SDK writes new
 * cross-signing keys into the account's secret storage before it publishes them, and the publish
 * is the step that can fail (the person closes the account confirmation, the server refuses it).
 * Had the new storage and backup come first, a failure would leave secret storage holding keys
 * the server never got, and the previous backup deleted. So a reset sets the old secret storage
 * aside while it publishes (the SDK then writes the keys nowhere) and puts it back when the
 * publish fails; the new storage, which stores the published keys, and the new backup follow.
 */
export const setUpRecovery = async (
  client: Pick<MatrixClient, 'getCrypto' | 'secretStorage'>,
  password: string,
  authUploadDeviceSigningKeys: UIAuthCallback<void>
): Promise<string> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);

  const recoveryKey = await crypto.createRecoveryKeyFromPassphrase(password);
  const { encodedPrivateKey } = recoveryKey;
  if (!encodedPrivateKey) throw new Error(RECOVERY_KEY_FAILED);

  const previousStorage = await client.secretStorage.getDefaultKeyId();
  if (previousStorage) await client.secretStorage.setDefaultKeyId(null);
  try {
    await crypto.bootstrapCrossSigning({ setupNewCrossSigning: true, authUploadDeviceSigningKeys });
  } catch (error) {
    if (previousStorage) await client.secretStorage.setDefaultKeyId(previousStorage);
    throw error;
  }

  // Keys cached for the previous secret storage cannot open the new one.
  const freshStorage: CreateSecretStorageOpts = {
    createSecretStorageKey: () => Promise.resolve(recoveryKey),
    ...FRESH_SECRET_STORAGE,
  };
  clearSecretStorageKeys();
  await crypto.bootstrapSecretStorage(freshStorage);
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
