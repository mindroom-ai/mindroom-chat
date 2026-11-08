// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { recoveryDialogAtom } from './recoveryDialog';
import { RecoveryDialogRenderer } from './RecoveryDialogRenderer';
import { setUpRecovery } from './recoveryPassword';

const client = vi.hoisted(() => ({ getSafeUserId: () => '@alice:example.org' }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('./recoveryState', () => ({ useRecoveryState: () => ({ kind: 'none' }) }));
// jsdom has no layout, so the real trap finds nothing tabbable; this stand-in renders through.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../devices/serverEncryptionSetup', () => ({ hasServerEncryptionSetup: vi.fn() }));
vi.mock('./recoveryPassword', async (importActual) => ({
  ...(await importActual<typeof import('./recoveryPassword')>()),
  setUpRecovery: vi.fn(),
}));

const typeInto = (name: string, value: string) => {
  const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  // jsdom lacks the form's named access to its fields, which `readNewRecoveryPassword` uses.
  Object.assign(input.form as HTMLFormElement, { [name]: input });
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// The start prompt opens Set up by itself, so the dialog can sit in an idle tab while the same
// account is set up on another device.
describe('RecoveryDialogRenderer setup left open', () => {
  it('sets nothing up when the server has a setup by Continue though it had none at open', async () => {
    vi.mocked(hasServerEncryptionSetup).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const store = createStore();
    store.set(recoveryDialogAtom, 'setup');
    await act(async () => {
      render(
        <Provider store={store}>
          <RecoveryDialogRenderer />
        </Provider>
      );
    });
    expect(screen.getByText('Set up your recovery password')).toBeTruthy();

    typeInto('recoveryPasswordInput', 'a long recovery password');
    typeInto('recoveryPasswordConfirmInput', 'a long recovery password');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    expect(hasServerEncryptionSetup).toHaveBeenCalledTimes(2);
    expect(setUpRecovery).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(store.get(recoveryDialogAtom)).toBe('setup');
  });
});
