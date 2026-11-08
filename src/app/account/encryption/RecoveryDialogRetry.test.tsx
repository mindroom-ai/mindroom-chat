// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { recoveryDialogAtom } from './recoveryDialog';
import { RecoveryDialogRenderer } from './RecoveryDialogRenderer';

const client = vi.hoisted(() => ({}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('./recoveryState', () => ({ useRecoveryState: () => ({ kind: 'none' }) }));
// jsdom has no layout, so the real trap finds nothing tabbable. This stand-in keeps what matters
// here: focus-trap-react runs `onDeactivate` when the trap unmounts, which closes the overlay.
vi.mock('focus-trap-react', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    default: function FocusTrap({
      children,
      focusTrapOptions,
    }: {
      children: React.ReactNode;
      focusTrapOptions: { onDeactivate: () => void };
    }) {
      const options = useRef(focusTrapOptions);
      options.current = focusTrapOptions;
      useEffect(() => () => options.current.onDeactivate(), []);
      return children;
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
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
});
