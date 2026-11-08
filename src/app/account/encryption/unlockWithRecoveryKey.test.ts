import { describe, expect, it, vi } from 'vitest';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';
import {
  CRYPTO_NOT_FOUND,
  NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE,
  unlockWithRecoveryKey,
} from './unlockWithRecoveryKey';

vi.mock('../../matrix/client/secretStorageKeys', () => ({ storePrivateKey: vi.fn() }));

const KEY = new Uint8Array([1, 2, 3]);

const cryptoWith = (privateKeysInSecretStorage: boolean) => ({
  userHasCrossSigningKeys: vi.fn(async () => true),
  getCrossSigningStatus: vi.fn(async () => ({ privateKeysInSecretStorage })),
  bootstrapCrossSigning: vi.fn(async () => undefined),
  loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(async () => undefined),
  checkKeyBackupAndEnable: vi.fn(async () => null),
});

describe('unlockWithRecoveryKey', () => {
  it('never bootstraps cross-signing when secret storage holds no cross-signing keys', async () => {
    vi.mocked(storePrivateKey).mockClear();
    const crypto = cryptoWith(false);

    await expect(
      unlockWithRecoveryKey(
        { getCrypto: () => crypto, getSafeUserId: () => '@me:example.org' } as never,
        'KEY_ID',
        KEY
      )
    ).rejects.toThrow(NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE);

    // The SDK would have created new keys and written them over secret storage.
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(crypto.checkKeyBackupAndEnable).not.toHaveBeenCalled();
    expect(storePrivateKey).not.toHaveBeenCalled();
  });

  it('caches the key and imports the keys from secret storage when they are there', async () => {
    vi.mocked(storePrivateKey).mockClear();
    const crypto = cryptoWith(true);

    await unlockWithRecoveryKey(
      { getCrypto: () => crypto, getSafeUserId: () => '@me:example.org' } as never,
      'KEY_ID',
      KEY
    );

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

  it('fails without crypto', async () => {
    await expect(
      unlockWithRecoveryKey({ getCrypto: () => undefined } as never, 'KEY_ID', KEY)
    ).rejects.toThrow(CRYPTO_NOT_FOUND);
  });
});
