// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { KeyBackupTile } from './KeyBackupTile';

const client = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client.current }));
const storage = vi.hoisted(() => ({
  key: undefined as unknown,
  turnOn: vi.fn(),
  keyFromInput: vi.fn(),
}));
vi.mock('../encryption/useDefaultSecretStorageKey', () => ({
  useDefaultSecretStorageKey: () => storage.key,
}));
vi.mock('../encryption/turnOnKeyBackup', async (importActual) => ({
  ...(await importActual<typeof import('../encryption/turnOnKeyBackup')>()),
  turnOnKeyBackup: storage.turnOn,
}));
vi.mock('../encryption/recoveryInput', async (importActual) => ({
  ...(await importActual<typeof import('../encryption/recoveryInput')>()),
  keyFromRecoveryInput: storage.keyFromInput,
}));

const NO_BACKUP_TEXT = 'No backup present on server!';
const CHECK_FAILED_TEXT = 'Could not check for a backup on the server.';

/** A client whose `GET /room_keys/version` answers with each of `answers` in turn. */
const clientAnswering = (...answers: Array<() => Promise<unknown>>) => {
  const authedRequest = vi.fn(() => {
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next();
  });
  client.current = Object.assign(new EventEmitter(), {
    http: { authedRequest },
    getCrypto: () => ({
      getActiveSessionBackupVersion: async () => '1',
      isKeyBackupTrusted: async () => ({ trusted: true, matchesDecryptionKey: true }),
    }),
  });
  return authedRequest;
};

const settle = () => act(async () => undefined);

afterEach(() => {
  cleanup();
  storage.key = undefined;
  vi.clearAllMocks();
});

describe('KeyBackupTile', () => {
  it('says there is no backup only when the server says so', async () => {
    clientAnswering(() =>
      Promise.reject(new MatrixError({ errcode: 'M_NOT_FOUND', error: 'No backup' }, 404))
    );
    render(<KeyBackupTile />);
    await settle();

    expect(screen.getByText(NO_BACKUP_TEXT)).toBeTruthy();
    expect(screen.queryByText(CHECK_FAILED_TEXT)).toBeNull();
  });

  it('shows the newest answer when the reads of a burst of backup events answer out of order', async () => {
    const backup = (version: string) => ({
      version,
      count: 12,
      algorithm: 'm.megolm_backup.v1',
      auth_data: {},
    });
    let answerSlowly: (value: unknown) => void = () => undefined;
    clientAnswering(
      () => Promise.resolve(backup('5')),
      () =>
        new Promise((resolve) => {
          answerSlowly = resolve;
        }),
      () => Promise.resolve(backup('7'))
    );
    render(<KeyBackupTile />);
    await settle();
    expect(screen.getByText(/Version: 5/)).toBeTruthy();

    // A reset: the first read after it is slow, the second one answers at once.
    const emitter = client.current as EventEmitter;
    await act(async () => {
      emitter.emit(CryptoEvent.KeyBackupStatus, true);
      emitter.emit(CryptoEvent.KeyBackupStatus, true);
    });
    expect(screen.getByText(/Version: 7/)).toBeTruthy();
    await act(async () => answerSlowly(backup('5')));

    expect(screen.getByText(/Version: 7/)).toBeTruthy();
  });

  it.each([
    ['rate limited', new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: 'Slow down' }, 429)],
    ['a server error', new MatrixError({ errcode: 'M_UNKNOWN', error: 'Internal error' }, 500)],
    ['offline', new TypeError('Failed to fetch')],
  ])('says the check failed when %s, and checks again on Retry', async (_case, failure) => {
    const authedRequest = clientAnswering(
      () => Promise.reject(failure),
      () =>
        Promise.resolve({ version: '7', count: 12, algorithm: 'm.megolm_backup.v1', auth_data: {} })
    );
    render(<KeyBackupTile />);
    await settle();

    expect(screen.getByRole('alert').textContent).toBe(CHECK_FAILED_TEXT);
    expect(screen.queryByText(NO_BACKUP_TEXT)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(authedRequest).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(CHECK_FAILED_TEXT)).toBeNull();
    expect(screen.getByText(/Version: 7/)).toBeTruthy();
  });
});

describe('KeyBackupTile without a backup', () => {
  const noBackup = () =>
    Promise.reject(new MatrixError({ errcode: 'M_NOT_FOUND', error: 'No backup' }, 404));

  it('offers to turn a backup on when the account has secret storage', async () => {
    storage.key = ['key1', { passphrase: { algorithm: 'm.pbkdf2', salt: 's', iterations: 1 } }];
    const derived = new Uint8Array([9]);
    storage.keyFromInput.mockResolvedValue(derived);
    storage.turnOn.mockResolvedValue(undefined);
    clientAnswering(noBackup, noBackup);
    render(<KeyBackupTile canTurnOn />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on backup' }));
    fireEvent.change(document.querySelector('input[name="recoveryInput"]') as HTMLInputElement, {
      target: { value: '  my recovery password  ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn on backup' }));
    });

    expect(storage.keyFromInput).toHaveBeenCalledWith(
      expect.anything(),
      'my recovery password',
      expect.objectContaining({ passphrase: expect.anything() })
    );
    expect(storage.turnOn).toHaveBeenCalledWith(expect.anything(), 'key1', derived);
    expect(document.querySelector('input[name="recoveryInput"]')).toBeNull();
  });

  it('offers nothing to a session that is not verified', async () => {
    storage.key = ['key1', {}];
    clientAnswering(noBackup);
    render(<KeyBackupTile canTurnOn={false} />);
    await settle();

    expect(screen.queryByRole('button', { name: 'Turn on backup' })).toBeNull();
  });

  it('offers nothing without secret storage to keep the backup key in', async () => {
    clientAnswering(noBackup);
    render(<KeyBackupTile canTurnOn />);
    await settle();

    expect(screen.getByText(NO_BACKUP_TEXT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on backup' })).toBeNull();
  });
});
