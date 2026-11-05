import { describe, expect, it, vi } from 'vitest';
import { MatrixError, type MatrixClient } from 'matrix-js-sdk';
import { hasServerEncryptionSetup } from './serverEncryptionSetup';

const ME = '@me:setup.test';

type Answers = {
  crossSigning?: () => Promise<boolean>;
  secretStorageKey?: () => Promise<string | null>;
  backup?: () => Promise<unknown>;
};

/** An account with nothing set up, unless a test answers one of the three questions otherwise. */
const accountWith = ({ crossSigning, secretStorageKey, backup }: Answers = {}) => {
  const userHasCrossSigningKeys = vi.fn(crossSigning ?? (async () => false));
  const getDefaultKeyId = vi.fn(secretStorageKey ?? (async () => null));
  const authedRequest = vi.fn(
    backup ??
      (async () =>
        Promise.reject(new MatrixError({ errcode: 'M_NOT_FOUND', error: 'No backup' }, 404)))
  );
  const client = {
    getCrypto: () => ({ userHasCrossSigningKeys }),
    getSafeUserId: () => ME,
    secretStorage: { getDefaultKeyId },
    http: { authedRequest },
  } as unknown as MatrixClient;
  return { client, userHasCrossSigningKeys };
};

describe('hasServerEncryptionSetup', () => {
  it('answers no for an account without cross-signing, secret storage or a backup', async () => {
    const { client, userHasCrossSigningKeys } = accountWith();

    await expect(hasServerEncryptionSetup(client)).resolves.toBe(false);

    // Downloads the account's keys when this session does not know them yet.
    expect(userHasCrossSigningKeys).toHaveBeenCalledWith(ME, true);
  });

  it.each<[string, Answers]>([
    ['published cross-signing keys', { crossSigning: async () => true }],
    ['a default secret storage key', { secretStorageKey: async () => 'key-id' }],
    ['a key backup', { backup: async () => ({ version: '1' }) }],
  ])('answers yes for an account with only %s', async (_name, answers) => {
    await expect(hasServerEncryptionSetup(accountWith(answers).client)).resolves.toBe(true);
  });

  it.each<[string, Answers]>([
    ['the cross-signing keys', { crossSigning: async () => Promise.reject(new Error('offline')) }],
    [
      'the secret storage key',
      { secretStorageKey: async () => Promise.reject(new Error('offline')) },
    ],
    [
      'the key backup',
      {
        backup: async () =>
          Promise.reject(new MatrixError({ errcode: 'M_UNKNOWN', error: 'Busy' }, 502)),
      },
    ],
  ])('rejects when %s cannot be checked, as an unanswered question is not a no', async (_n, a) => {
    await expect(hasServerEncryptionSetup(accountWith(a).client)).rejects.toThrow();
  });

  it('rejects without a crypto module', async () => {
    const client = { ...accountWith().client, getCrypto: () => undefined } as MatrixClient;
    await expect(hasServerEncryptionSetup(client)).rejects.toThrow('No crypto module');
  });
});
