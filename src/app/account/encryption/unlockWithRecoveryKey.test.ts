import { describe, expect, it, vi } from 'vitest';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';
import {
  CRYPTO_NOT_FOUND,
  NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE,
  holdsPublishedIdentity,
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

  // A stale view of the account's identity could make healthy secret storage look mismatched and
  // offer a repair that replaces a sound identity.
  it('fails, touching nothing, when the server cannot say what the identity is', async () => {
    vi.mocked(storePrivateKey).mockClear();
    const crypto = cryptoWith(true);
    crypto.userHasCrossSigningKeys.mockRejectedValue(new Error('M_LIMIT_EXCEEDED'));

    await expect(
      unlockWithRecoveryKey(
        { getCrypto: () => crypto, getSafeUserId: () => '@me:example.org' } as never,
        'KEY_ID',
        KEY
      )
    ).rejects.toThrow('M_LIMIT_EXCEEDED');
    expect(storePrivateKey).not.toHaveBeenCalled();
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it('fails without crypto', async () => {
    await expect(
      unlockWithRecoveryKey({ getCrypto: () => undefined } as never, 'KEY_ID', KEY)
    ).rejects.toThrow(CRYPTO_NOT_FOUND);
  });
});

describe('holdsPublishedIdentity', () => {
  const clientWith = (refresh: () => Promise<boolean>, keyId: string | null) =>
    ({
      getCrypto: () => ({
        userHasCrossSigningKeys: vi.fn(refresh),
        getCrossSigningKeyId: vi.fn(async () => keyId),
      }),
      getSafeUserId: () => '@me:example.org',
    } as never);

  it('is true when the keys held here match the identity the server publishes', async () => {
    await expect(holdsPublishedIdentity(clientWith(async () => true, 'MASTER'))).resolves.toBe(
      true
    );
  });

  it('is false when they do not', async () => {
    await expect(holdsPublishedIdentity(clientWith(async () => true, null))).resolves.toBe(false);
  });

  it('is false when the server cannot be asked, whatever this session holds', async () => {
    const offline = clientWith(() => Promise.reject(new Error('offline')), 'MASTER');
    await expect(holdsPublishedIdentity(offline)).resolves.toBe(false);
  });
});
