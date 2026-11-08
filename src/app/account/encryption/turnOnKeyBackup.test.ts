import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { BACKUP_ALREADY_EXISTS, turnOnKeyBackup } from './turnOnKeyBackup';

const mocks = vi.hoisted(() => ({ storePrivateKey: vi.fn(), fetchKeyBackupVersion: vi.fn() }));
vi.mock('../../matrix/client/secretStorageKeys', () => ({
  storePrivateKey: mocks.storePrivateKey,
}));
vi.mock('./keyBackupVersion', () => ({ fetchKeyBackupVersion: mocks.fetchKeyBackupVersion }));

const KEY = new Uint8Array([4, 2]);

type FakeCrypto = Record<string, ReturnType<typeof vi.fn>>;

/** A crypto module whose backup calls are recorded in order. */
const makeCrypto = (calls: string[]): FakeCrypto => {
  let version = 0;
  let active: string | null = null;
  return {
    resetKeyBackup: vi.fn(async () => {
      version += 1;
      calls.push(`reset:${version}`);
    }),
    checkKeyBackupAndEnable: vi.fn(async () => {
      active = String(version);
      calls.push(`enable:${active}`);
    }),
    getActiveSessionBackupVersion: vi.fn(async () => active),
    deleteKeyBackupVersion: vi.fn(async (deleted: string) => {
      calls.push(`delete:${deleted}`);
      active = null;
    }),
  };
};

const clientWith = (crypto: FakeCrypto | undefined) =>
  ({ getCrypto: () => crypto, http: {} } as unknown as Pick<MatrixClient, 'getCrypto' | 'http'>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchKeyBackupVersion.mockResolvedValue(null);
});

describe('turnOnKeyBackup', () => {
  it('caches the secret storage key, then makes a backup every key of this session goes into', async () => {
    const calls: string[] = [];
    mocks.storePrivateKey.mockImplementation(() => void calls.push('cache'));
    await turnOnKeyBackup(clientWith(makeCrypto(calls)), 'key1', KEY);

    expect(mocks.storePrivateKey).toHaveBeenCalledWith('key1', KEY);
    // The first version is turned off by deleting it while active, which makes the SDK forget
    // the keys it uploaded to an earlier backup; the second one then receives all of them.
    expect(calls).toEqual(['cache', 'reset:1', 'enable:1', 'delete:1', 'reset:2', 'enable:2']);
  });

  it('never replaces a backup the account already has', async () => {
    mocks.fetchKeyBackupVersion.mockResolvedValue({ version: '3' });
    const crypto = makeCrypto([]);

    await expect(turnOnKeyBackup(clientWith(crypto), 'key1', KEY)).rejects.toThrow(
      BACKUP_ALREADY_EXISTS
    );
    expect(crypto.resetKeyBackup).not.toHaveBeenCalled();
  });

  it('fails without a crypto module', async () => {
    await expect(turnOnKeyBackup(clientWith(undefined), 'key1', KEY)).rejects.toThrow();
  });
});
