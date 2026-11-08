// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { recoveryDialogAtom } from './recoveryDialog';
import { RecoveryDialogRenderer } from './RecoveryDialogRenderer';
import {
  useRecoveryState,
  type DefaultSecretStorageKey,
  type RecoveryState,
} from './recoveryState';

const client = vi.hoisted(() => ({}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('./recoveryState', () => ({ useRecoveryState: vi.fn() }));
vi.mock('../devices/serverEncryptionSetup', () => ({ hasServerEncryptionSetup: vi.fn() }));
vi.mock('../verification/SecurityOverlay', () => ({
  SecurityOverlay: ({
    children,
    onClose,
    dismissible = true,
  }: {
    children: React.ReactNode;
    onClose: () => void;
    dismissible?: boolean;
  }) => (
    <div data-testid="overlay" data-dismissible={String(dismissible)}>
      <button type="button" onClick={onClose}>
        overlay-close
      </button>
      {children}
    </div>
  ),
}));
vi.mock('../verification/SecurityDialog', () => ({
  SecurityDialog: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock('../verification/DeviceVerificationSetup', () => ({
  DeviceVerificationSetup: ({
    onCancel,
    onKeepOpenChange,
    confirmFresh = true,
    onExistingSetup,
  }: {
    onCancel: () => void;
    onKeepOpenChange: (keepOpen: boolean) => void;
    confirmFresh?: boolean;
    onExistingSetup?: () => void;
  }) => (
    <div data-testid="setup" data-confirm-fresh={String(confirmFresh)}>
      setup-dialog
      <button type="button" onClick={onCancel}>
        setup-cancel
      </button>
      <button type="button" onClick={() => onKeepOpenChange(true)}>
        setup-keep-open
      </button>
      <button type="button" onClick={onExistingSetup}>
        setup-found-existing
      </button>
    </div>
  ),
}));
vi.mock('../verification/ResetVerificationDialog', () => ({
  ResetVerificationDialog: ({
    onReset,
    onCancel,
  }: {
    onReset: () => void;
    onCancel: () => void;
  }) => (
    <div>
      reset-dialog
      <button type="button" onClick={onReset}>
        reset-confirm
      </button>
      <button type="button" onClick={onCancel}>
        reset-cancel
      </button>
    </div>
  ),
}));
vi.mock('./RecoveryUnlockDialog', () => ({
  RecoveryUnlockDialog: ({
    secretStorageKey,
    onClose,
    onForgot,
    onSetPassword,
  }: {
    secretStorageKey: DefaultSecretStorageKey;
    onClose: () => void;
    onForgot: () => void;
    onSetPassword: () => void;
  }) => (
    <div data-testid="unlock-dialog">
      unlock-dialog {secretStorageKey.keyId}
      <button type="button" onClick={onClose}>
        unlock-close
      </button>
      <button type="button" onClick={onForgot}>
        unlock-forgot
      </button>
      <button type="button" onClick={onSetPassword}>
        unlock-set-password
      </button>
    </div>
  ),
}));
vi.mock('./ChangeRecoveryPassword', () => ({
  ChangeRecoveryPassword: ({
    secretStorageKey,
    askCurrent,
    onClose,
  }: {
    secretStorageKey: DefaultSecretStorageKey;
    askCurrent: boolean;
    onClose: () => void;
  }) => (
    <div>
      change-dialog {secretStorageKey.keyId} ask-current-{String(askCurrent)}
      <button type="button" onClick={onClose}>
        change-close
      </button>
    </div>
  ),
}));

const KEY: DefaultSecretStorageKey = { keyId: 'key1', keyContent: {}, hasPassphrase: true };
const NONE: RecoveryState = { kind: 'none' };
const LOCKED: RecoveryState = { kind: 'locked', key: KEY };
const READY: RecoveryState = { kind: 'ready', key: KEY };

const recoveryState = vi.mocked(useRecoveryState);
const serverHasSetup = vi.mocked(hasServerEncryptionSetup);

const renderRenderer = async (dialog: 'setup' | 'unlock' | 'reset' | 'change' | undefined) => {
  const store = createStore();
  store.set(recoveryDialogAtom, dialog);
  const view = await act(async () =>
    render(
      <Provider store={store}>
        <RecoveryDialogRenderer />
      </Provider>
    )
  );
  return { store, ...view };
};

const rerenderWith = async (
  view: Awaited<ReturnType<typeof renderRenderer>>,
  state: RecoveryState
) => {
  recoveryState.mockReturnValue(state);
  await act(async () =>
    view.rerender(
      <Provider store={view.store}>
        <RecoveryDialogRenderer />
      </Provider>
    )
  );
};

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

beforeEach(() => {
  recoveryState.mockReturnValue(LOCKED);
  serverHasSetup.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('RecoveryDialogRenderer', () => {
  it('renders nothing while the atom is unset', async () => {
    await renderRenderer(undefined);
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('shows the unlock dialog with the account key and clears the atom on close', async () => {
    const { store } = await renderRenderer('unlock');
    expect(screen.getByText(/unlock-dialog key1/)).toBeTruthy();
    await click('unlock-close');
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('moves from unlock to reset on Forgot and to change on Set a recovery password', async () => {
    const forgot = await renderRenderer('unlock');
    await click('unlock-forgot');
    expect(forgot.store.get(recoveryDialogAtom)).toBe('reset');
    expect(screen.getByText('reset-dialog')).toBeTruthy();
    cleanup();

    const change = await renderRenderer('unlock');
    await click('unlock-set-password');
    expect(change.store.get(recoveryDialogAtom)).toBe('change');
    expect(screen.getByText(/change-dialog key1 ask-current-false/)).toBeTruthy();
  });

  it('shows the change dialog without asking for the current password and clears on close', async () => {
    const { store } = await renderRenderer('change');
    expect(screen.getByText(/change-dialog key1 ask-current-false/)).toBeTruthy();
    await click('change-close');
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('shows the reset warning first and the setup after confirming', async () => {
    const { store } = await renderRenderer('reset');
    expect(screen.queryByText('setup-dialog')).toBeNull();
    await click('reset-confirm');
    expect(screen.getByText('setup-dialog')).toBeTruthy();
    expect(screen.queryByText('reset-dialog')).toBeNull();
    await click('setup-cancel');
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('clears the atom when the reset warning is cancelled', async () => {
    const { store } = await renderRenderer('reset');
    await click('reset-cancel');
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('shows the setup when the server has no encryption setup yet', async () => {
    recoveryState.mockReturnValue(NONE);
    await renderRenderer('setup');
    expect(serverHasSetup).toHaveBeenCalledTimes(1);
    expect(screen.getByText('setup-dialog')).toBeTruthy();
    expect(screen.queryByText('reset-dialog')).toBeNull();
  });

  it('shows the reset warning, not the setup, when the server already has one', async () => {
    recoveryState.mockReturnValue(NONE);
    serverHasSetup.mockResolvedValue(true);
    await renderRenderer('setup');
    expect(screen.getByText('reset-dialog')).toBeTruthy();
    expect(screen.queryByText('setup-dialog')).toBeNull();
    await click('reset-confirm');
    expect(screen.getByText('setup-dialog')).toBeTruthy();
  });

  it('keeps the overlay up with a spinner while the server check runs', async () => {
    recoveryState.mockReturnValue(NONE);
    serverHasSetup.mockReturnValue(new Promise(() => undefined));
    await renderRenderer('setup');
    expect(screen.getByTestId('overlay')).toBeTruthy();
    expect(screen.queryByText('setup-dialog')).toBeNull();
  });

  it('offers Retry when the check fails and runs it again', async () => {
    recoveryState.mockReturnValue(NONE);
    serverHasSetup.mockRejectedValueOnce(new Error('offline'));
    await renderRenderer('setup');
    expect(screen.getByText("Couldn't check your encryption setup.")).toBeTruthy();
    expect(screen.queryByText('setup-dialog')).toBeNull();
    await click('Retry');
    expect(serverHasSetup).toHaveBeenCalledTimes(2);
    expect(screen.getByText('setup-dialog')).toBeTruthy();
  });

  it('keeps Escape off while a dialog asks to stay open', async () => {
    recoveryState.mockReturnValue(NONE);
    await renderRenderer('setup');
    expect(screen.getByTestId('overlay').dataset.dismissible).toBe('true');
    await click('setup-keep-open');
    expect(screen.getByTestId('overlay').dataset.dismissible).toBe('false');
  });

  it('renders nothing for unlock until the state carries a key', async () => {
    recoveryState.mockReturnValue({ kind: 'unknown' });
    const { rerender, store } = await renderRenderer('unlock');
    expect(screen.queryByTestId('overlay')).toBeNull();
    recoveryState.mockReturnValue(LOCKED);
    await act(async () =>
      rerender(
        <Provider store={store}>
          <RecoveryDialogRenderer />
        </Provider>
      )
    );
    expect(screen.getByText(/unlock-dialog key1/)).toBeTruthy();
  });

  it('follows a key that replaced the old one on another device, as after a changed password', async () => {
    const { rerender, store } = await renderRenderer('unlock');
    expect(screen.getByText(/unlock-dialog key1/)).toBeTruthy();
    recoveryState.mockReturnValue({ kind: 'locked', key: { ...KEY, keyId: 'key2' } });
    await act(async () =>
      rerender(
        <Provider store={store}>
          <RecoveryDialogRenderer />
        </Provider>
      )
    );
    expect(screen.getByText(/unlock-dialog key2/)).toBeTruthy();
  });

  it('keeps the same unlock dialog mounted when the state moves to ready or unknown', async () => {
    const { rerender, store } = await renderRenderer('unlock');
    const dialog = screen.getByTestId('unlock-dialog');
    for (const next of [READY, { kind: 'unknown' } as RecoveryState, READY]) {
      recoveryState.mockReturnValue(next);
      await act(async () =>
        rerender(
          <Provider store={store}>
            <RecoveryDialogRenderer />
          </Provider>
        )
      );
      expect(screen.getByTestId('unlock-dialog')).toBe(dialog);
    }
  });

  it('asks the server again at Continue on a fresh setup, not after a confirmed reset', async () => {
    recoveryState.mockReturnValue(NONE);
    await renderRenderer('setup');
    expect(screen.getByTestId('setup').dataset.confirmFresh).toBe('true');
    cleanup();

    recoveryState.mockReturnValue(READY);
    await renderRenderer('reset');
    await click('reset-confirm');
    expect(screen.getByTestId('setup').dataset.confirmFresh).toBe('false');
    cleanup();

    recoveryState.mockReturnValue(NONE);
    serverHasSetup.mockResolvedValue(true);
    await renderRenderer('setup');
    await click('reset-confirm');
    expect(screen.getByTestId('setup').dataset.confirmFresh).toBe('false');
  });

  it('shows the reset warning when the setup finds an account set up meanwhile', async () => {
    recoveryState.mockReturnValue(NONE);
    const { store } = await renderRenderer('setup');
    await click('setup-found-existing');
    expect(screen.getByText('reset-dialog')).toBeTruthy();
    expect(screen.queryByText('setup-dialog')).toBeNull();
    expect(store.get(recoveryDialogAtom)).toBe('setup');
    await click('reset-confirm');
    expect(screen.getByTestId('setup').dataset.confirmFresh).toBe('false');
  });

  it.each([
    ['locked', LOCKED],
    ['ready', READY],
  ])('closes an idle setup dialog once the state turns %s', async (_kind, next) => {
    recoveryState.mockReturnValue(NONE);
    const view = await renderRenderer('setup');
    expect(screen.getByText('setup-dialog')).toBeTruthy();
    await rerenderWith(view, next);
    expect(view.store.get(recoveryDialogAtom)).toBeUndefined();
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('keeps the setup dialog while it runs or after a confirmed reset when the state turns locked', async () => {
    recoveryState.mockReturnValue(NONE);
    const running = await renderRenderer('setup');
    await click('setup-keep-open');
    await rerenderWith(running, LOCKED);
    expect(running.store.get(recoveryDialogAtom)).toBe('setup');
    expect(screen.getByText('setup-dialog')).toBeTruthy();
    cleanup();

    recoveryState.mockReturnValue(NONE);
    serverHasSetup.mockResolvedValue(true);
    const confirmed = await renderRenderer('setup');
    await click('reset-confirm');
    await rerenderWith(confirmed, LOCKED);
    expect(confirmed.store.get(recoveryDialogAtom)).toBe('setup');
    expect(screen.getByText('setup-dialog')).toBeTruthy();
  });
});
