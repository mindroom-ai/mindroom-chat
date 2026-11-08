import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { isCrossSigningMismatch, repairCrossSigning } from './repairCrossSigning';

const mocks = vi.hoisted(() => ({ storePrivateKey: vi.fn() }));
vi.mock('../../matrix/client/secretStorageKeys', () => ({
  storePrivateKey: mocks.storePrivateKey,
}));

/** The error the Rust crypto stack throws when secret storage holds another identity. */
const MISMATCH_ERROR = new Error(
  "Error while importing m.cross_signing.master: The public key of the imported private key doesn't match the public key that was uploaded to the server"
);

const makeCrypto = () => ({
  loadSessionBackupPrivateKeyFromSecretStorage: vi.fn().mockResolvedValue(undefined),
  bootstrapCrossSigning: vi.fn().mockResolvedValue(undefined),
  checkKeyBackupAndEnable: vi.fn().mockResolvedValue(null),
  bootstrapSecretStorage: vi.fn(),
  resetKeyBackup: vi.fn(),
});

const clientWith = (crypto: ReturnType<typeof makeCrypto> | undefined) =>
  ({ getCrypto: () => crypto } as unknown as Pick<MatrixClient, 'getCrypto'>);

const KEY = new Uint8Array([7, 7, 7]);
const auth = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isCrossSigningMismatch', () => {
  it('recognizes the SDK error for an identity the server never published', () => {
    expect(isCrossSigningMismatch(MISMATCH_ERROR)).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isCrossSigningMismatch(new Error('Invalid recovery password or key.'))).toBe(false);
    expect(isCrossSigningMismatch('doesn’t match')).toBe(false);
  });
});

describe('repairCrossSigning', () => {
  it('keeps the backup key, then publishes a new identity under the same secret storage key', async () => {
    const crypto = makeCrypto();
    await repairCrossSigning(clientWith(crypto), 'key1', KEY, auth);

    expect(mocks.storePrivateKey).toHaveBeenCalledWith('key1', KEY);
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledWith({
      setupNewCrossSigning: true,
      authUploadDeviceSigningKeys: auth,
    });
    const order = [
      mocks.storePrivateKey,
      crypto.loadSessionBackupPrivateKeyFromSecretStorage,
      crypto.bootstrapCrossSigning,
      crypto.checkKeyBackupAndEnable,
    ].map((fn) => fn.mock.invocationCallOrder[0] as number);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The password, the secret storage key and the backup stay as they are.
    expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    expect(crypto.resetKeyBackup).not.toHaveBeenCalled();
  });

  it('still repairs the identity when secret storage holds no usable backup key', async () => {
    const crypto = makeCrypto();
    crypto.loadSessionBackupPrivateKeyFromSecretStorage.mockRejectedValue(
      new Error('missing decryption key in secret storage')
    );
    await repairCrossSigning(clientWith(crypto), 'key1', KEY, auth);

    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledTimes(1);
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalledTimes(1);
  });

  it('fails when publishing the new identity fails', async () => {
    const crypto = makeCrypto();
    crypto.bootstrapCrossSigning.mockRejectedValue(new Error('Authentication cancelled'));

    await expect(repairCrossSigning(clientWith(crypto), 'key1', KEY, auth)).rejects.toThrow(
      'Authentication cancelled'
    );
    expect(crypto.checkKeyBackupAndEnable).not.toHaveBeenCalled();
  });

  it('fails without a crypto module', async () => {
    await expect(repairCrossSigning(clientWith(undefined), 'key1', KEY, auth)).rejects.toThrow();
  });
});
