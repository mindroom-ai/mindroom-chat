import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSecretStorageKeys } from '../../matrix/client/secretStorageKeys';
import { fetchKeyBackupVersion } from './keyBackupVersion';
import {
  RECOVERY_KEY_FAILED,
  RECOVERY_SECRETS_NOT_CACHED,
  SECRET_STORAGE_INCOMPLETE,
  setUpRecovery,
  storeSecretsUnderNewKey,
} from './recoveryPassword';

vi.mock('../../matrix/client/secretStorageKeys', () => ({ clearSecretStorageKeys: vi.fn() }));
vi.mock('./keyBackupVersion', () => ({ fetchKeyBackupVersion: vi.fn() }));

const GENERATED = { keyInfo: {}, privateKey: new Uint8Array([1]), encodedPrivateKey: 'EsT1 KEY' };

type Cached = { masterKey: boolean; selfSigningKey: boolean; userSigningKey: boolean };
const ALL_CACHED: Cached = { masterKey: true, selfSigningKey: true, userSigningKey: true };

const makeCrypto = (
  options: {
    generated?: typeof GENERATED | { encodedPrivateKey?: undefined };
    cached?: Cached;
    backupInfo?: { version: string } | null;
    backupKeyMatches?: boolean;
    ready?: boolean;
  } = {}
) => {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) =>
    vi.fn(async (..._args: unknown[]) => {
      calls.push(name);
      return value;
    });
  const crypto = {
    createRecoveryKeyFromPassphrase: track('create', options.generated ?? GENERATED),
    bootstrapSecretStorage: track('storage', undefined),
    bootstrapCrossSigning: track('crossSigning', undefined),
    getCrossSigningStatus: track('status', {
      privateKeysCachedLocally: options.cached ?? ALL_CACHED,
    }),
    // This session holds a backup key; whether it fits the server's backup is the question.
    getSessionBackupPrivateKey: track('backupKey', new Uint8Array([7])),
    getKeyBackupInfo: track('backupInfo', options.backupInfo ?? null),
    isKeyBackupTrusted: track('backupTrust', {
      trusted: true,
      matchesDecryptionKey: options.backupKeyMatches ?? false,
    }),
    getSecretStorageStatus: track('storageStatus', { ready: options.ready ?? true }),
  };
  return { crypto, calls };
};

beforeEach(() => {
  vi.mocked(clearSecretStorageKeys).mockReset();
  vi.mocked(fetchKeyBackupVersion).mockReset();
  vi.mocked(fetchKeyBackupVersion).mockResolvedValue(null);
});

/** The account's secret storage pointer: `null` for an account that never had one. */
const storageOf = (calls: string[], defaultKeyId: string | null) => ({
  getDefaultKeyId: vi.fn(async () => {
    calls.push('readDefault');
    return defaultKeyId;
  }),
  setDefaultKeyId: vi.fn(async (keyId: string | null) => {
    calls.push(`setDefault:${keyId}`);
  }),
});

describe('setUpRecovery', () => {
  it('publishes the new identity before it creates secret storage and the key backup', async () => {
    const { crypto, calls } = makeCrypto();
    vi.mocked(clearSecretStorageKeys).mockImplementation(() => void calls.push('clear'));
    const secretStorage = storageOf(calls, null);
    const auth = vi.fn();

    const key = await setUpRecovery(
      { getCrypto: () => crypto, secretStorage } as never,
      'a long recovery password',
      auth
    );

    expect(key).toBe('EsT1 KEY');
    expect(calls).toEqual(['create', 'readDefault', 'crossSigning', 'clear', 'storage']);
    expect(secretStorage.setDefaultKeyId).not.toHaveBeenCalled();
    expect(crypto.createRecoveryKeyFromPassphrase).toHaveBeenCalledWith('a long recovery password');
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledWith({
      authUploadDeviceSigningKeys: auth,
      setupNewCrossSigning: true,
    });
    expect(crypto.bootstrapSecretStorage).toHaveBeenCalledWith({
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
      createSecretStorageKey: expect.any(Function),
    });
    const [{ createSecretStorageKey }] = crypto.bootstrapSecretStorage.mock.calls[0] as [
      { createSecretStorageKey: () => Promise<unknown> }
    ];
    await expect(createSecretStorageKey()).resolves.toBe(GENERATED);
  });

  it('a reset sets the old secret storage aside while it publishes, so no new key lands in it', async () => {
    const { crypto, calls } = makeCrypto();
    vi.mocked(clearSecretStorageKeys).mockImplementation(() => void calls.push('clear'));
    const secretStorage = storageOf(calls, 'old-key');

    await setUpRecovery(
      { getCrypto: () => crypto, secretStorage } as never,
      'a long recovery password',
      vi.fn()
    );

    expect(calls).toEqual([
      'create',
      'readDefault',
      'setDefault:null',
      'crossSigning',
      'clear',
      'storage',
    ]);
  });

  it('a publish that fails leaves secret storage and the key backup as they were', async () => {
    const { crypto, calls } = makeCrypto();
    crypto.bootstrapCrossSigning.mockImplementation(async () => {
      calls.push('crossSigning');
      throw new Error('Authentication cancelled');
    });
    vi.mocked(clearSecretStorageKeys).mockImplementation(() => void calls.push('clear'));
    const secretStorage = storageOf(calls, 'old-key');

    await expect(
      setUpRecovery(
        { getCrypto: () => crypto, secretStorage } as never,
        'a long recovery password',
        vi.fn()
      )
    ).rejects.toThrow('Authentication cancelled');
    expect(calls).toEqual([
      'create',
      'readDefault',
      'setDefault:null',
      'crossSigning',
      'setDefault:old-key',
    ]);
    expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    expect(clearSecretStorageKeys).not.toHaveBeenCalled();
  });

  it('setUpRecovery fails without an encoded key', async () => {
    const { crypto, calls } = makeCrypto({ generated: {} });

    await expect(
      setUpRecovery(
        { getCrypto: () => crypto, secretStorage: storageOf(calls, null) } as never,
        'a long recovery password',
        vi.fn()
      )
    ).rejects.toThrow(RECOVERY_KEY_FAILED);
    expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });
});

describe('storeSecretsUnderNewKey', () => {
  const client = (crypto: unknown) => ({ getCrypto: () => crypto, http: {} } as never);

  it('storeSecretsUnderNewKey writes the cached secrets under the new key without a new backup', async () => {
    const { crypto, calls } = makeCrypto();
    vi.mocked(clearSecretStorageKeys).mockImplementation(() => void calls.push('clear'));

    await storeSecretsUnderNewKey(client(crypto), GENERATED);

    expect(calls).toEqual(['status', 'clear', 'storage', 'storageStatus']);
    expect(crypto.bootstrapSecretStorage).toHaveBeenCalledTimes(1);
    const [options] = crypto.bootstrapSecretStorage.mock.calls[0] as [
      { createSecretStorageKey: () => Promise<unknown> }
    ];
    expect(Object.keys(options).sort()).toEqual([
      'createSecretStorageKey',
      'setupNewSecretStorage',
    ]);
    expect(options).toMatchObject({ setupNewSecretStorage: true });
    await expect(options.createSecretStorageKey()).resolves.toBe(GENERATED);
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it('storeSecretsUnderNewKey refuses when a cross-signing key is not cached', async () => {
    const { crypto } = makeCrypto({ cached: { ...ALL_CACHED, userSigningKey: false } });

    await expect(storeSecretsUnderNewKey(client(crypto), GENERATED)).rejects.toThrow(
      RECOVERY_SECRETS_NOT_CACHED
    );
    expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    expect(clearSecretStorageKeys).not.toHaveBeenCalled();
  });

  // The SDK writes the backup key into the new storage only when it matches the backup, and
  // skips it without a word otherwise (another session may have reset the backup).
  it('storeSecretsUnderNewKey refuses a backup key that does not match the backup', async () => {
    vi.mocked(fetchKeyBackupVersion).mockResolvedValue({ version: '2' } as never);
    const { crypto } = makeCrypto({ backupInfo: { version: '2' }, backupKeyMatches: false });

    await expect(storeSecretsUnderNewKey(client(crypto), GENERATED)).rejects.toThrow(
      RECOVERY_SECRETS_NOT_CACHED
    );
    expect(crypto.isKeyBackupTrusted).toHaveBeenCalledWith({ version: '2' });
    expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    expect(clearSecretStorageKeys).not.toHaveBeenCalled();
  });

  it("storeSecretsUnderNewKey refuses when the SDK's copy of the backup is not the server's", async () => {
    vi.mocked(fetchKeyBackupVersion).mockResolvedValue({ version: '2' } as never);
    const { crypto } = makeCrypto({ backupInfo: { version: '1' }, backupKeyMatches: true });

    await expect(storeSecretsUnderNewKey(client(crypto), GENERATED)).rejects.toThrow(
      RECOVERY_SECRETS_NOT_CACHED
    );
    expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    expect(clearSecretStorageKeys).not.toHaveBeenCalled();
  });

  it('storeSecretsUnderNewKey writes when the held backup key matches the backup', async () => {
    vi.mocked(fetchKeyBackupVersion).mockResolvedValue({ version: '2' } as never);
    const { crypto } = makeCrypto({ backupInfo: { version: '2' }, backupKeyMatches: true });

    await storeSecretsUnderNewKey(client(crypto), GENERATED);
    expect(crypto.bootstrapSecretStorage).toHaveBeenCalledTimes(1);
  });

  it('storeSecretsUnderNewKey reports secret storage that is not ready afterwards', async () => {
    const { crypto } = makeCrypto({ ready: false });

    await expect(storeSecretsUnderNewKey(client(crypto), GENERATED)).rejects.toThrow(
      SECRET_STORAGE_INCOMPLETE
    );
  });
});
