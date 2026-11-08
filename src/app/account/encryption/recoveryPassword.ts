import type { MatrixClient, UIAuthCallback } from 'matrix-js-sdk';
import type {
  CreateSecretStorageOpts,
  CryptoApi,
  GeneratedSecretStorageKey,
} from 'matrix-js-sdk/lib/crypto-api';
import { clearSecretStorageKeys } from '../../matrix/client/secretStorageKeys';
import { fetchKeyBackupVersion } from './keyBackupVersion';
import { holdsPublishedIdentity, refreshOwnIdentity } from './unlockWithRecoveryKey';

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
 * Runs `publish` while the SDK sees no secret storage, in this tab only: the SDK writes new
 * cross-signing keys into secret storage when it has one, before it publishes them. Nothing on the
 * server changes, so a tab that closes meanwhile leaves the account as it was.
 */
const withoutSecretStorage = async (
  storage: MatrixClient['secretStorage'],
  publish: () => Promise<void>
): Promise<void> => {
  const hasKey = storage.hasKey.bind(storage);
  storage.hasKey = () => Promise.resolve(false);
  try {
    await publish();
  } finally {
    storage.hasKey = hasKey;
  }
};

/**
 * Creates new cross-signing keys, then new secret storage and key backup, with the secret storage
 * key derived from `password`. Resolves to the encoded recovery key.
 *
 * The identity is published first, and nothing else changes until it is: the publish is the step
 * that can fail (the person closes the account confirmation, the server refuses it). Had the new
 * storage and backup come first, a failure would leave secret storage holding keys the server
 * never got, and the previous backup deleted. A failed publish also leaves this session holding
 * the unpublished keys, so the server's identity is asked for again and the keys this session
 * held before are put back before the error goes on.
 */
export const setUpRecovery = async (
  client: Pick<MatrixClient, 'getCrypto' | 'secretStorage' | 'getSafeUserId'>,
  password: string,
  authUploadDeviceSigningKeys: UIAuthCallback<void>
): Promise<string> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);

  const recoveryKey = await crypto.createRecoveryKeyFromPassphrase(password);
  const { encodedPrivateKey } = recoveryKey;
  if (!encodedPrivateKey) throw new Error(RECOVERY_KEY_FAILED);

  // None on an account without cross-signing yet.
  const previous = await crypto.exportSecretsBundle?.().catch(() => undefined);
  try {
    await withoutSecretStorage(client.secretStorage, () =>
      crypto.bootstrapCrossSigning({ setupNewCrossSigning: true, authUploadDeviceSigningKeys })
    );
  } catch (error) {
    await refreshOwnIdentity(client);
    if (previous) await crypto.importSecretsBundle?.(previous).catch(() => undefined);
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
 * Refuses, before touching anything, when this session lacks any of them, or holds an identity
 * the server no longer publishes (one replaced on another device), which would overwrite the
 * account's.
 */
export const storeSecretsUnderNewKey = async (
  client: Pick<MatrixClient, 'getCrypto' | 'http' | 'getSafeUserId'>,
  recoveryKey: GeneratedSecretStorageKey
): Promise<void> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(CRYPTO_NOT_FOUND);

  if (!(await holdsPublishedIdentity(client)) || !(await holdsBackupKey(client, crypto))) {
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
