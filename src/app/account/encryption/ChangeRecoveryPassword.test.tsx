// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeRecoveryPassword } from './ChangeRecoveryPassword';
import { keyFromRecoveryInput } from './recoveryInput';
import {
  CRYPTO_NOT_FOUND,
  RECOVERY_SECRETS_NOT_CACHED,
  SECRET_STORAGE_INCOMPLETE,
  storeSecretsUnderNewKey,
} from './recoveryPassword';
import { unlockWithRecoveryKey } from './unlockWithRecoveryKey';
import type { DefaultSecretStorageKey } from './recoveryState';

const mocks = vi.hoisted(() => ({
  createRecoveryKeyFromPassphrase: vi.fn(),
  getCrossSigningStatus: vi.fn(),
  loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(),
  storePrivateKey: vi.fn(),
}));

vi.mock('../../matrix/client/secretStorageKeys', () => ({
  storePrivateKey: mocks.storePrivateKey,
}));

vi.mock('./recoveryInput', async (importActual) => ({
  ...(await importActual<typeof import('./recoveryInput')>()),
  keyFromRecoveryInput: vi.fn(),
}));
vi.mock('./unlockWithRecoveryKey', async (importActual) => ({
  ...(await importActual<typeof import('./unlockWithRecoveryKey')>()),
  unlockWithRecoveryKey: vi.fn(),
}));
vi.mock('./recoveryPassword', async (importActual) => ({
  ...(await importActual<typeof import('./recoveryPassword')>()),
  storeSecretsUnderNewKey: vi.fn(),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@alice:example.org',
    getCrypto: () => ({
      createRecoveryKeyFromPassphrase: mocks.createRecoveryKeyFromPassphrase,
      getCrossSigningStatus: mocks.getCrossSigningStatus,
      loadSessionBackupPrivateKeyFromSecretStorage:
        mocks.loadSessionBackupPrivateKeyFromSecretStorage,
    }),
  }),
}));

const KEY: DefaultSecretStorageKey = { keyId: 'key1', keyContent: {}, hasPassphrase: true };
const DERIVED = new Uint8Array([1, 2, 3]);
const NEW_KEY = { privateKey: new Uint8Array([9]), encodedPrivateKey: 'EsTc 1234' };

const derive = vi.mocked(keyFromRecoveryInput);
const unlock = vi.mocked(unlockWithRecoveryKey);
const store = vi.mocked(storeSecretsUnderNewKey);

const typeInto = (name: string, value: string) => {
  const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  // jsdom lacks the form's named access to its fields, which `readNewRecoveryPassword` uses.
  Object.assign(input.form as HTMLFormElement, { [name]: input });
};

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

const unlockWithCurrent = async () => {
  typeInto('recoveryInput', 'the old password');
  await click('Continue');
};

const chooseNewPassword = async () => {
  typeInto('recoveryPasswordInput', ' a new long password ');
  typeInto('recoveryPasswordConfirmInput', 'a new long password');
  await click('Change');
};

const renderChange = (askCurrent = true) =>
  render(
    <ChangeRecoveryPassword secretStorageKey={KEY} askCurrent={askCurrent} onClose={vi.fn()} />
  );

const cached = (masterKey: boolean, selfSigningKey = true, userSigningKey = true) =>
  mocks.getCrossSigningStatus.mockResolvedValue({
    privateKeysCachedLocally: { masterKey, selfSigningKey, userSigningKey },
  });

beforeEach(() => {
  cached(false);
  derive.mockResolvedValue(DERIVED);
  unlock.mockResolvedValue(undefined);
  store.mockResolvedValue(undefined);
  mocks.createRecoveryKeyFromPassphrase.mockResolvedValue(NEW_KEY);
  mocks.loadSessionBackupPrivateKeyFromSecretStorage.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChangeRecoveryPassword', () => {
  it('asks for the current password before the new one', async () => {
    renderChange();
    expect(screen.getByLabelText('Recovery password')).toBeTruthy();
    expect(screen.queryByLabelText('Confirm recovery password')).toBeNull();
    expect(screen.getByText('Change your recovery password')).toBeTruthy();

    await unlockWithCurrent();
    expect(screen.getByLabelText('Confirm recovery password')).toBeTruthy();
    expect(derive).toHaveBeenCalledWith(expect.anything(), 'the old password', KEY.keyContent);
  });

  it('unlocks with the current password, then stores the secrets under a key made from the new one', async () => {
    renderChange();
    await unlockWithCurrent();
    await chooseNewPassword();

    expect(unlock).toHaveBeenCalledWith(expect.anything(), 'key1', DERIVED);
    expect(mocks.createRecoveryKeyFromPassphrase).toHaveBeenCalledWith('a new long password');
    expect(store).toHaveBeenCalledWith(expect.anything(), NEW_KEY);
    expect(unlock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createRecoveryKeyFromPassphrase.mock.invocationCallOrder[0] as number
    );
    expect(mocks.createRecoveryKeyFromPassphrase.mock.invocationCallOrder[0]).toBeLessThan(
      store.mock.invocationCallOrder[0] as number
    );
    expect(screen.getByText('I saved my recovery password')).toBeTruthy();
  });

  it('step 1 skips the unlock when this session already holds the cross-signing keys', async () => {
    cached(true);
    renderChange();
    await unlockWithCurrent();
    expect(unlock).not.toHaveBeenCalled();
    expect(mocks.storePrivateKey).toHaveBeenCalledWith('key1', DERIVED);
    expect(screen.getByLabelText('Confirm recovery password')).toBeTruthy();
    cleanup();

    // A backup key cached here may be stale; the one in secret storage replaces it.
    expect(mocks.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalledTimes(1);
    expect(mocks.storePrivateKey.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadSessionBackupPrivateKeyFromSecretStorage.mock.invocationCallOrder[0] as number
    );
    mocks.loadSessionBackupPrivateKeyFromSecretStorage.mockRejectedValue(new Error('no backup'));
    renderChange();
    await unlockWithCurrent();
    expect(screen.getByLabelText('Confirm recovery password')).toBeTruthy();
    cleanup();

    derive.mockRejectedValue(new Error('That recovery password or key is not right.'));
    renderChange();
    await unlockWithCurrent();
    expect(screen.getByText('That recovery password or key is not right.')).toBeTruthy();
    expect(screen.queryByLabelText('Confirm recovery password')).toBeNull();
  });

  it('step 1 unlocks when a cross-signing key is not cached', async () => {
    cached(true, true, false);
    renderChange();
    await unlockWithCurrent();
    expect(unlock).toHaveBeenCalledWith(expect.anything(), 'key1', DERIVED);
    expect(mocks.storePrivateKey).not.toHaveBeenCalled();
  });

  it('shows a wrong current password and stays on that step', async () => {
    derive.mockRejectedValue(new Error('That recovery password or key is not right.'));
    renderChange();
    await unlockWithCurrent();
    expect(screen.getByText('That recovery password or key is not right.')).toBeTruthy();
    expect(screen.queryByLabelText('Confirm recovery password')).toBeNull();
  });

  it('Retry writes again with the same new key', async () => {
    store.mockRejectedValueOnce(new Error(SECRET_STORAGE_INCOMPLETE));
    renderChange();
    await unlockWithCurrent();
    await chooseNewPassword();
    expect(screen.getByText(/does not cover every encryption key yet/)).toBeTruthy();

    await click('Retry');
    expect(store).toHaveBeenCalledTimes(2);
    expect(store.mock.calls[1]?.[1]).toBe(store.mock.calls[0]?.[1]);
    expect(mocks.createRecoveryKeyFromPassphrase).toHaveBeenCalledTimes(1);
    expect(screen.getByText('I saved my recovery password')).toBeTruthy();
  });

  it('the not-cached error says to verify this session first', async () => {
    store.mockRejectedValue(new Error(RECOVERY_SECRETS_NOT_CACHED));
    renderChange(false);
    await chooseNewPassword();
    expect(
      screen.getByText(
        'This session does not hold every encryption key. Verify it with your recovery password or another device, then try again.'
      )
    ).toBeTruthy();
  });

  it.each([RECOVERY_SECRETS_NOT_CACHED, CRYPTO_NOT_FOUND])(
    'after a refusal that wrote nothing the fields stay editable and no Retry shows: %s',
    async (message) => {
      store.mockRejectedValueOnce(new Error(message));
      renderChange(false);
      await chooseNewPassword();
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(screen.getByLabelText<HTMLInputElement>('Recovery password').disabled).toBe(false);
      expect(screen.getByLabelText<HTMLInputElement>('Confirm recovery password').disabled).toBe(
        false
      );

      // The next try starts again from the typed password.
      await click('Change');
      expect(mocks.createRecoveryKeyFromPassphrase).toHaveBeenCalledTimes(2);
      expect(screen.getByText('I saved my recovery password')).toBeTruthy();
    }
  );

  it('askCurrent false starts at the new password', async () => {
    renderChange(false);
    expect(screen.getByLabelText('Confirm recovery password')).toBeTruthy();
    await chooseNewPassword();
    expect(derive).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledTimes(1);
  });

  it('rejects a short or mismatched new password before touching anything', async () => {
    renderChange(false);
    typeInto('recoveryPasswordInput', 'short');
    typeInto('recoveryPasswordConfirmInput', 'short');
    await click('Change');
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy();
    expect(mocks.createRecoveryKeyFromPassphrase).not.toHaveBeenCalled();
  });

  it('keeps the dialog open while running and on the saved step, never otherwise', async () => {
    const onKeepOpenChange = vi.fn();
    render(
      <ChangeRecoveryPassword
        secretStorageKey={KEY}
        askCurrent={false}
        onClose={vi.fn()}
        onKeepOpenChange={onKeepOpenChange}
      />
    );
    expect(onKeepOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    await chooseNewPassword();
    expect(onKeepOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  // A password and a confirmation without a username read as a change of the login password, so
  // a password manager could offer to overwrite the saved login with the recovery password.
  it('gives password managers a username of their own for the recovery password', () => {
    renderChange(false);
    const username = document.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(username).toBeTruthy();
    expect(username.type).toBe('text');
    expect(username.value).toBe('@alice:example.org recovery password');
    expect(username.readOnly).toBe(true);
    expect(username.tabIndex).toBe(-1);
    expect(username.getAttribute('aria-hidden')).toBe('true');
    expect(username.style.display).not.toBe('none');
    expect(username.form).toBe(
      (document.querySelector('input[name="recoveryPasswordInput"]') as HTMLInputElement).form
    );
  });
});
