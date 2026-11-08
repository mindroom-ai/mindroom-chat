import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';
import { fetchKeyBackupVersion } from './keyBackupVersion';
import {
  CRYPTO_NOT_FOUND,
  NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE,
  unlockWithRecoveryKey,
} from './unlockWithRecoveryKey';

vi.mock('../../matrix/client/secretStorageKeys', () => ({ storePrivateKey: vi.fn() }));
vi.mock('./keyBackupVersion', () => ({ fetchKeyBackupVersion: vi.fn() }));

const KEY = new Uint8Array([1, 2, 3]);

const cryptoWith = (privateKeysInSecretStorage: boolean) => ({
  userHasCrossSigningKeys: vi.fn(async () => true),
  getCrossSigningStatus: vi.fn(async () => ({ privateKeysInSecretStorage })),
  bootstrapCrossSigning: vi.fn(async () => undefined),
  loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(async () => undefined),
  checkKeyBackupAndEnable: vi.fn(async () => null),
});

const client = (crypto: unknown) =>
  ({ getCrypto: () => crypto, getSafeUserId: () => '@me:example.org', http: {} } as never);

beforeEach(() => {
  vi.mocked(storePrivateKey).mockClear();
  vi.mocked(fetchKeyBackupVersion).mockReset();
  vi.mocked(fetchKeyBackupVersion).mockResolvedValue({ version: '1' } as never);
});

describe('unlockWithRecoveryKey', () => {
  it('never bootstraps cross-signing when secret storage holds no cross-signing keys', async () => {
    vi.mocked(storePrivateKey).mockClear();
    const crypto = cryptoWith(false);

    await expect(unlockWithRecoveryKey(client(crypto), 'KEY_ID', KEY)).rejects.toThrow(
      NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE
    );

    // The SDK would have created new keys and written them over secret storage.
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(crypto.checkKeyBackupAndEnable).not.toHaveBeenCalled();
    expect(storePrivateKey).not.toHaveBeenCalled();
  });

  it('caches the key and imports the keys from secret storage when they are there', async () => {
    vi.mocked(storePrivateKey).mockClear();
    const crypto = cryptoWith(true);

    await unlockWithRecoveryKey(client(crypto), 'KEY_ID', KEY);

    expect(storePrivateKey).toHaveBeenCalledWith('KEY_ID', KEY);
    // The server's identity is asked for first, so stale keys of this session cannot pass.
    expect(crypto.userHasCrossSigningKeys).toHaveBeenCalledWith('@me:example.org', true);
    expect(crypto.userHasCrossSigningKeys.mock.invocationCallOrder[0]).toBeLessThan(
      crypto.getCrossSigningStatus.mock.invocationCallOrder[0] as number
    );
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledWith({});
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalled();
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalled();
  });

  // A stale view of the account's identity could make healthy secret storage look mismatched and
  // offer a repair that replaces a sound identity.
  it('fails, touching nothing, when the server cannot say what the identity is', async () => {
    vi.mocked(storePrivateKey).mockClear();
    const crypto = cryptoWith(true);
    crypto.userHasCrossSigningKeys.mockRejectedValue(new Error('M_LIMIT_EXCEEDED'));

    await expect(unlockWithRecoveryKey(client(crypto), 'KEY_ID', KEY)).rejects.toThrow(
      'M_LIMIT_EXCEEDED'
    );
    expect(storePrivateKey).not.toHaveBeenCalled();
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it('fails before verifying anything when the server cannot say whether there is a backup', async () => {
    vi.mocked(fetchKeyBackupVersion).mockRejectedValue(new Error('M_UNKNOWN 502'));
    const crypto = cryptoWith(true);

    await expect(unlockWithRecoveryKey(client(crypto), 'KEY_ID', KEY)).rejects.toThrow(
      'M_UNKNOWN 502'
    );
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).not.toHaveBeenCalled();
  });

  it('loads no backup key for an account without a backup', async () => {
    vi.mocked(fetchKeyBackupVersion).mockResolvedValue(null);
    const crypto = cryptoWith(true);

    await unlockWithRecoveryKey(client(crypto), 'KEY_ID', KEY);
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).not.toHaveBeenCalled();
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledWith({});
  });

  it('fails without crypto', async () => {
    await expect(
      unlockWithRecoveryKey({ getCrypto: () => undefined } as never, 'KEY_ID', KEY)
    ).rejects.toThrow(CRYPTO_NOT_FOUND);
  });
});
