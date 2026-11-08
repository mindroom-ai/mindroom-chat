// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportRoomKeyStage } from 'matrix-js-sdk/lib/crypto-api';
import { ConnectionError } from 'matrix-js-sdk';
import { RecoveryUnlock } from './RecoveryUnlock';
import { INVALID_RECOVERY_INPUT } from './recoveryInput';
import {
  NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE,
  unlockWithRecoveryKey,
} from './unlockWithRecoveryKey';
import type { DefaultSecretStorageKey } from './recoveryState';

const mocks = vi.hoisted(() => ({
  repairCrossSigning: vi.fn(),
  keyFromRecoveryInput: vi.fn(),
  restoreKeyBackup: vi.fn(),
  backupVersion: vi.fn(),
}));

vi.mock('./recoveryInput', async (importActual) => ({
  ...(await importActual<typeof import('./recoveryInput')>()),
  keyFromRecoveryInput: mocks.keyFromRecoveryInput,
}));
vi.mock('./repairCrossSigning', async (importActual) => ({
  ...(await importActual<typeof import('./repairCrossSigning')>()),
  repairCrossSigning: mocks.repairCrossSigning,
}));
vi.mock('./unlockWithRecoveryKey', async (importActual) => ({
  ...(await importActual<typeof import('./unlockWithRecoveryKey')>()),
  unlockWithRecoveryKey: vi.fn(),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getCrypto: () => ({
      restoreKeyBackup: mocks.restoreKeyBackup,
      getActiveSessionBackupVersion: mocks.backupVersion,
    }),
  }),
}));

const KEY: DefaultSecretStorageKey = { keyId: 'key1', keyContent: {}, hasPassphrase: true };
const KEY_ONLY: DefaultSecretStorageKey = { ...KEY, hasPassphrase: false };
const DERIVED = new Uint8Array([1, 2, 3]);

const unlock = vi.mocked(unlockWithRecoveryKey);

const submit = async (text: string) => {
  fireEvent.change(document.querySelector('input[name="recoveryInput"]') as HTMLInputElement, {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  });
};

/** What the Rust crypto stack throws when secret storage holds an identity never published. */
const MISMATCH = new Error(
  "Error while importing m.cross_signing.master: The public key of the imported private key doesn't match the public key that was uploaded to the server"
);

beforeEach(() => {
  mocks.repairCrossSigning.mockResolvedValue(undefined);
  mocks.keyFromRecoveryInput.mockResolvedValue(DERIVED);
  mocks.restoreKeyBackup.mockResolvedValue(undefined);
  mocks.backupVersion.mockResolvedValue('1');
  unlock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecoveryUnlock repair', () => {
  it('offers a repair instead of the SDK error when the stored identity is not the account one', async () => {
    unlock.mockRejectedValue(MISMATCH);
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(screen.queryByText(/doesn't match the public key/)).toBeNull();
    expect(screen.getByText(/gives your account a new identity/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Repair encryption' })).toBeTruthy();
    expect(mocks.repairCrossSigning).not.toHaveBeenCalled();
  });

  it('repairs with the key the password gave, then restores the history', async () => {
    unlock.mockRejectedValue(MISMATCH);
    const onUnlocked = vi.fn();
    render(<RecoveryUnlock secretStorageKey={KEY} onUnlocked={onUnlocked} />);
    await submit('my long password');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repair encryption' }));
    });

    expect(mocks.repairCrossSigning).toHaveBeenCalledWith(
      expect.anything(),
      'key1',
      DERIVED,
      expect.any(Function)
    );
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(mocks.restoreKeyBackup).toHaveBeenCalledTimes(1);
    expect(screen.getByText('This device is verified.')).toBeTruthy();
    expect(screen.getByText('Encryption repaired. Verify your other devices again.')).toBeTruthy();
  });

  it('says a closed account confirmation in words and lets the person try again', async () => {
    const { AuthenticationCancelled } = await import('../uia/useAuthenticatedAction');
    unlock.mockRejectedValue(MISMATCH);
    mocks.repairCrossSigning.mockRejectedValueOnce(new AuthenticationCancelled());
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repair encryption' }));
    });

    expect(screen.getByText('Repair needs your account confirmation. Try again.')).toBeTruthy();
    expect(mocks.restoreKeyBackup).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repair encryption' }));
    });
    expect(mocks.repairCrossSigning).toHaveBeenCalledTimes(2);
    expect(screen.getByText('This device is verified.')).toBeTruthy();
  });
});

describe('RecoveryUnlock', () => {
  it('unlocks with what the user typed and starts a full restore', async () => {
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('  my long password  ');

    expect(mocks.keyFromRecoveryInput).toHaveBeenCalledWith(
      expect.anything(),
      'my long password',
      KEY.keyContent
    );
    expect(unlock).toHaveBeenCalledWith(expect.anything(), 'key1', DERIVED);
    expect(mocks.restoreKeyBackup).toHaveBeenCalledTimes(1);
    expect(unlock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreKeyBackup.mock.invocationCallOrder[0] as number
    );
    expect(screen.getByText('This device is verified.')).toBeTruthy();
    expect(screen.getByText('Your messages are restored.')).toBeTruthy();
  });

  it('shows restore progress while it runs', async () => {
    mocks.restoreKeyBackup.mockImplementation(
      async ({ progressCallback }: { progressCallback: (p: unknown) => void }) => {
        progressCallback({
          stage: ImportRoomKeyStage.LoadKeys,
          total: 4,
          successes: 1,
          failures: 1,
        });
        await new Promise(() => undefined);
      }
    );
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(screen.getByText('Restoring your messages… 50%')).toBeTruthy();
  });

  it('shows a wrong password as one translated line', async () => {
    mocks.keyFromRecoveryInput.mockRejectedValue(new Error(INVALID_RECOVERY_INPUT));
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('wrong');

    expect(screen.getByText('That recovery password or key is not right.')).toBeTruthy();
    expect(unlock).not.toHaveBeenCalled();
    expect(mocks.restoreKeyBackup).not.toHaveBeenCalled();
  });

  it('keeps the no cross-signing keys error', async () => {
    unlock.mockRejectedValue(new Error(NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE));
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(screen.getByText(/holds no cross-signing keys/)).toBeTruthy();
    expect(mocks.restoreKeyBackup).not.toHaveBeenCalled();
  });

  it('says in words that the server was out of reach', async () => {
    unlock.mockRejectedValue(new ConnectionError('fetch failed', new TypeError('x')));
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(
      screen.getByText("Couldn't reach the server. Check your connection and try again.")
    ).toBeTruthy();
  });

  it('a failed restore does not undo the unlock', async () => {
    mocks.restoreKeyBackup.mockRejectedValue(new Error('boom'));
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(screen.getByText('This device is verified.')).toBeTruthy();
    expect(
      screen.getByText('Some messages could not be restored. You can try again in Settings.')
    ).toBeTruthy();
    expect(screen.queryByText('That recovery password or key is not right.')).toBeNull();
  });

  it('skips the restore when there is no backup to restore', async () => {
    mocks.backupVersion.mockResolvedValue(null);
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(mocks.restoreKeyBackup).not.toHaveBeenCalled();
    expect(screen.getByText('This device is verified.')).toBeTruthy();
  });

  it('labels the field Recovery key when the account has no password', () => {
    const { unmount } = render(<RecoveryUnlock secretStorageKey={KEY} />);
    expect(screen.getByLabelText('Recovery password')).toBeTruthy();
    unmount();
    render(<RecoveryUnlock secretStorageKey={KEY_ONLY} />);
    expect(screen.getByLabelText('Recovery key')).toBeTruthy();
  });

  it('offers to set a password on the success step, for key-only accounts only', async () => {
    const onSetPassword = vi.fn();
    const { unmount } = render(
      <RecoveryUnlock secretStorageKey={KEY} onSetPassword={onSetPassword} />
    );
    await submit('my long password');
    expect(screen.queryByRole('button', { name: 'Set a recovery password' })).toBeNull();
    unmount();

    render(<RecoveryUnlock secretStorageKey={KEY_ONLY} onSetPassword={onSetPassword} />);
    expect(screen.queryByRole('button', { name: 'Set a recovery password' })).toBeNull();
    await submit('my long recovery key');
    fireEvent.click(screen.getByRole('button', { name: 'Set a recovery password' }));
    expect(onSetPassword).toHaveBeenCalledTimes(1);
  });

  it('still restores when the form is unmounted before the unlock resolves', async () => {
    let finish: () => void = () => undefined;
    unlock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const onUnlocked = vi.fn();
    const { unmount } = render(<RecoveryUnlock secretStorageKey={KEY} onUnlocked={onUnlocked} />);
    await submit('my long password');
    unmount();
    await act(async () => finish());

    expect(mocks.restoreKeyBackup).toHaveBeenCalledTimes(1);
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('tells the parent when an unlock starts and when it succeeds', async () => {
    const onUnlockStarted = vi.fn();
    const onUnlocked = vi.fn();
    render(
      <RecoveryUnlock
        secretStorageKey={KEY}
        onUnlockStarted={onUnlockStarted}
        onUnlocked={onUnlocked}
      />
    );
    await submit('my long password');

    expect(onUnlockStarted).toHaveBeenCalledTimes(1);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('disables Unlock while it runs', async () => {
    unlock.mockReturnValue(new Promise(() => undefined));
    render(<RecoveryUnlock secretStorageKey={KEY} />);
    await submit('my long password');

    expect(screen.getByRole('button', { name: 'Unlock' }).hasAttribute('disabled')).toBe(true);
  });
});
