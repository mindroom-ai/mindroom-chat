import { describe, expect, it, vi } from 'vitest';
import { deriveRecoveryKeyFromPassphrase, encodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api';
import {
  INVALID_RECOVERY_INPUT,
  keyFromRecoveryInput,
  type SecretStorageKeyContent,
} from './recoveryInput';

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const clientAccepting = (expected: Uint8Array) => {
  const checkKey = vi.fn((key: Uint8Array) => Promise.resolve(sameBytes(key, expected)));
  return { client: { secretStorage: { checkKey } } as never, checkKey };
};

const recoveryKey = new Uint8Array(32).map((_, index) => index * 7 + 1);
const encoded = encodeRecoveryKey(recoveryKey) ?? '';
const passphrase = { algorithm: 'm.pbkdf2', salt: 'salt', iterations: 10 };
const withPassphrase: SecretStorageKeyContent = { passphrase };

describe('keyFromRecoveryInput', () => {
  it('decodes a recovery key typed with spaces and line breaks', async () => {
    const { client } = clientAccepting(recoveryKey);
    const typed = `  ${encoded.replace(/(.{4})/g, '$1 \n ')}  `;
    await expect(keyFromRecoveryInput(client, typed, {})).resolves.toEqual(recoveryKey);
  });

  it('derives the key from a password with surrounding spaces', async () => {
    const derived = await deriveRecoveryKeyFromPassphrase('correct horse battery', 'salt', 10);
    const { client } = clientAccepting(derived);
    await expect(
      keyFromRecoveryInput(client, '  correct horse battery  ', withPassphrase)
    ).resolves.toEqual(derived);
  });

  it('rejects a wrong password', async () => {
    const derived = await deriveRecoveryKeyFromPassphrase('correct horse battery', 'salt', 10);
    const { client } = clientAccepting(derived);
    await expect(
      keyFromRecoveryInput(client, 'wrong horse battery', withPassphrase)
    ).rejects.toThrow(new Error(INVALID_RECOVERY_INPUT));
  });

  it('rejects a well-formed recovery key that secret storage does not accept', async () => {
    const { client } = clientAccepting(new Uint8Array(32));
    await expect(keyFromRecoveryInput(client, encoded, withPassphrase)).rejects.toThrow(
      new Error(INVALID_RECOVERY_INPUT)
    );
  });

  it('derives the key from a password that reads as another recovery key', async () => {
    const derived = await deriveRecoveryKeyFromPassphrase(encoded, 'salt', 10);
    const { client } = clientAccepting(derived);
    await expect(keyFromRecoveryInput(client, encoded, withPassphrase)).resolves.toEqual(derived);
  });

  it('rejects a password when the key has no passphrase', async () => {
    const { client, checkKey } = clientAccepting(recoveryKey);
    await expect(keyFromRecoveryInput(client, 'correct horse battery', {})).rejects.toThrow(
      new Error(INVALID_RECOVERY_INPUT)
    );
    expect(checkKey).not.toHaveBeenCalled();
  });

  it('rejects blank input', async () => {
    const { client, checkKey } = clientAccepting(recoveryKey);
    await expect(keyFromRecoveryInput(client, ' \n ', withPassphrase)).rejects.toThrow(
      new Error(INVALID_RECOVERY_INPUT)
    );
    expect(checkKey).not.toHaveBeenCalled();
  });
});
