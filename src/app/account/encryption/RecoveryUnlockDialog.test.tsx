// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryUnlockDialog } from './RecoveryUnlockDialog';
import type { DefaultSecretStorageKey } from './recoveryState';

const requestOwnUserVerification = vi.hoisted(() => vi.fn());

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getCrypto: () => ({ requestOwnUserVerification }) }),
}));
// The unlock form and the verification steps have their own tests.
vi.mock('./RecoveryUnlock', () => ({ RecoveryUnlock: () => null }));
vi.mock('../verification/SecurityDialog', () => ({
  SecurityDialog: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock('../verification/VerificationRequestDialog', async (importActual) => ({
  ...(await importActual<typeof import('../verification/VerificationRequestDialog')>()),
  VerificationRequestDialog: () => <p>verification-dialog</p>,
}));

const KEY: DefaultSecretStorageKey = { keyId: 'key1', keyContent: {}, hasPassphrase: true };

afterEach(cleanup);

const renderDialog = () =>
  render(<RecoveryUnlockDialog secretStorageKey={KEY} onClose={vi.fn()} onForgot={vi.fn()} />);

const verifyWithDevice = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Verify with another device instead' }));
  });
};

describe('RecoveryUnlockDialog', () => {
  it('ends a request to another device that is in flight when it closes', async () => {
    const request = { pending: true, cancel: vi.fn(() => Promise.resolve()) };
    requestOwnUserVerification.mockResolvedValue(request);
    const { unmount } = renderDialog();
    await verifyWithDevice();
    expect(screen.getByText('verification-dialog')).toBeTruthy();
    expect(request.cancel).not.toHaveBeenCalled();

    unmount();
    expect(request.cancel).toHaveBeenCalledTimes(1);
  });

  it('ends a request that arrives after it closed', async () => {
    const request = { pending: true, cancel: vi.fn(() => Promise.resolve()) };
    let answer: (value: typeof request) => void = () => undefined;
    requestOwnUserVerification.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const { unmount } = renderDialog();
    await verifyWithDevice();
    unmount();

    await act(async () => answer(request));
    expect(request.cancel).toHaveBeenCalledTimes(1);
  });
});
