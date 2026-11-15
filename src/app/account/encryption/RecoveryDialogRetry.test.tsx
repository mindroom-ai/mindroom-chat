// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { isRecoveryPromptSnoozed, recoveryDialogAtom } from './recoveryDialog';
import { RecoveryDialogRenderer } from './RecoveryDialogRenderer';
import type { DefaultSecretStorageKey, RecoveryState } from './recoveryState';

const client = vi.hoisted(() => ({ getSafeUserId: () => '@alice:example.org' }));
const recovery = vi.hoisted(() => ({ state: { kind: 'none' } as RecoveryState }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('./recoveryState', () => ({ useRecoveryState: () => recovery.state }));
vi.mock('./RecoveryUnlockDialog', () => ({ RecoveryUnlockDialog: () => <div>unlock-dialog</div> }));
// jsdom has no layout, so the real trap finds nothing tabbable. This stand-in keeps what matters
// here, as focus-trap-react does it: the trap keeps the options of its first render and runs their
// `onDeactivate` once, on Escape (the `trap-escape` button) or, still active, when it unmounts.
vi.mock('focus-trap-react', async () => {
  const { Component } = await import('react');
  return {
    default: class FocusTrap extends Component<{
      children: React.ReactNode;
      focusTrapOptions: { onDeactivate: () => void };
    }> {
      private readonly options = this.props.focusTrapOptions;

      private active = true;

      private readonly deactivate = () => {
        if (!this.active) return;
        this.active = false;
        this.options.onDeactivate();
      };

      override componentWillUnmount() {
        this.deactivate();
      }

      override render() {
        return (
          <>
            {this.props.children}
            <button type="button" onClick={this.deactivate}>
              trap-escape
            </button>
          </>
        );
      }
    },
  };
});
vi.mock('../devices/serverEncryptionSetup', () => ({ hasServerEncryptionSetup: vi.fn() }));
vi.mock('../verification/DeviceVerificationSetup', () => ({
  DeviceVerificationSetup: () => (
    <div>
      setup-dialog
      <button type="button">stub</button>
    </div>
  ),
}));

const KEY: DefaultSecretStorageKey = { keyId: 'key1', keyContent: {}, hasPassphrase: true };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  recovery.state = { kind: 'none' };
});

// The real SecurityOverlay closes the dialog when it unmounts, so Retry must not unmount it.
describe('RecoveryDialogRenderer with the real overlay', () => {
  it('keeps the dialog open on Retry and shows the setup when the second check answers false', async () => {
    vi.mocked(hasServerEncryptionSetup)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(false);
    const store = createStore();
    store.set(recoveryDialogAtom, 'setup');
    await act(async () => {
      render(
        <Provider store={store}>
          <RecoveryDialogRenderer />
        </Provider>
      );
    });
    expect(screen.getByText("Couldn't check your encryption setup.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(store.get(recoveryDialogAtom)).toBe('setup');
    expect(screen.getByText('setup-dialog')).toBeTruthy();
  });

  it('a dialog cleared from outside, as when the account is set up elsewhere, snoozes nothing', async () => {
    localStorage.clear();
    vi.mocked(hasServerEncryptionSetup).mockResolvedValue(false);
    const store = createStore();
    store.set(recoveryDialogAtom, 'setup');
    await act(async () => {
      render(
        <Provider store={store}>
          <RecoveryDialogRenderer />
        </Provider>
      );
    });
    expect(screen.getByText('setup-dialog')).toBeTruthy();
    await act(async () => store.set(recoveryDialogAtom, undefined));
    expect(screen.queryByText('setup-dialog')).toBeNull();
    expect(isRecoveryPromptSnoozed('@alice:example.org')).toBe(false);
  });
  it("the account's pages leaving with the dialog open, as on an account switch, snooze nothing", async () => {
    localStorage.clear();
    vi.mocked(hasServerEncryptionSetup).mockResolvedValue(false);
    const store = createStore();
    store.set(recoveryDialogAtom, 'setup');
    const { unmount } = await act(async () =>
      render(
        <Provider store={store}>
          <RecoveryDialogRenderer />
        </Provider>
      )
    );
    expect(screen.getByText('setup-dialog')).toBeTruthy();
    unmount();
    expect(isRecoveryPromptSnoozed('@alice:example.org')).toBe(false);
  });

  it('Escape snoozes while the session is locked, and not once it has turned ready', async () => {
    localStorage.clear();
    recovery.state = { kind: 'locked', key: KEY };
    const store = createStore();
    store.set(recoveryDialogAtom, 'unlock');
    const tree = () => (
      <Provider store={store}>
        <RecoveryDialogRenderer />
      </Provider>
    );
    const { rerender } = render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'trap-escape' }));
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
    expect(isRecoveryPromptSnoozed('@alice:example.org')).toBe(true);

    localStorage.clear();
    act(() => store.set(recoveryDialogAtom, 'unlock'));
    expect(screen.getByText('unlock-dialog')).toBeTruthy();
    // Unlocked in the dialog: the trap still holds the close of the render that saw it locked.
    recovery.state = { kind: 'ready', key: KEY };
    rerender(tree());
    fireEvent.click(screen.getByRole('button', { name: 'trap-escape' }));
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
    expect(isRecoveryPromptSnoozed('@alice:example.org')).toBe(false);
  });
});
