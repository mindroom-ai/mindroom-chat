// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { SecuritySettings } from './SecuritySettings';
import type { RecoveryState } from '../encryption/recoveryState';

const client = vi.hoisted(() => ({ current: undefined as unknown }));
const recovery = vi.hoisted(() => ({ current: { kind: 'none' } as RecoveryState }));
vi.mock('../encryption/recoveryState', async (importActual) => ({
  ...(await importActual<typeof import('../encryption/recoveryState')>()),
  useRecoveryState: () => recovery.current,
}));
vi.mock('../encryption/ChangeRecoveryPassword', () => ({
  ChangeRecoveryPassword: () => <div role="dialog">change password</div>,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client.current }));
vi.mock('../../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./KeyBackupTile', () => ({ KeyBackupTile: () => null }));
vi.mock('../verification/SecurityOverlay', () => ({
  SecurityOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../verification/ResetVerificationDialog', () => ({
  ResetVerificationDialog: ({ onReset }: { onReset: () => void }) => (
    <div role="alertdialog">
      <button type="button" aria-label="Confirm reset" onClick={onReset} />
      reset warning
    </div>
  ),
}));
vi.mock('../verification/DeviceVerificationSetup', () => ({
  DeviceVerificationSetup: ({
    confirmFresh = true,
    onExistingSetup,
  }: {
    confirmFresh?: boolean;
    onExistingSetup?: () => void;
  }) => (
    <div role="dialog" data-confirm-fresh={String(confirmFresh)}>
      <button type="button" aria-label="Found existing" onClick={onExistingSetup} />
      new setup
    </div>
  ),
}));

type ServerState = {
  crossSigning: boolean | Error;
  secretStorageKeyId?: string | null;
  backup?: { version: string } | Error | null;
};

const noBackup = () => new MatrixError({ errcode: 'M_NOT_FOUND', error: 'No backup' }, 404);

/** An account whose server answers as given; this session itself has not seen any of it yet. */
const accountOnServer = ({
  crossSigning,
  secretStorageKeyId = null,
  backup = null,
}: ServerState) => {
  const userHasCrossSigningKeys = vi.fn(async () => {
    if (crossSigning instanceof Error) throw crossSigning;
    return crossSigning;
  });
  const fake = {
    getSafeUserId: () => '@alice:example.org',
    getCrypto: () => ({ userHasCrossSigningKeys }),
    secretStorage: { getDefaultKeyId: vi.fn(async () => secretStorageKeyId) },
    http: {
      authedRequest: vi.fn(async () => {
        if (backup instanceof Error) throw backup;
        if (backup === null) throw noBackup();
        return backup;
      }),
    },
  };
  client.current = fake;
  return { userHasCrossSigningKeys, fake };
};

/** This session's view: it does not know of any cross-signing keys yet. */
const UNKNOWN_HERE = { crossSigning: false, thisDeviceVerified: false, otherDevices: new Map() };

const clickEnable = async () => {
  render(<SecuritySettings trust={UNKNOWN_HERE} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
  });
};

afterEach(cleanup);

describe('SecuritySettings Enable', () => {
  it('asks the server, and sends an account with cross-signing keys to the reset warning', async () => {
    const { userHasCrossSigningKeys } = accountOnServer({
      crossSigning: true,
      secretStorageKeyId: 'KEY',
      backup: { version: '1' },
    });
    await clickEnable();

    expect(userHasCrossSigningKeys).toHaveBeenCalledWith('@alice:example.org', true);
    expect(screen.getByRole('alertdialog').textContent).toBe('reset warning');
    expect(screen.queryByText('new setup')).toBeNull();
  });

  it('warns first when only secret storage or only a key backup exists', async () => {
    accountOnServer({ crossSigning: false, secretStorageKeyId: 'KEY' });
    await clickEnable();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    cleanup();

    accountOnServer({ crossSigning: false, backup: { version: '4' } });
    await clickEnable();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByText('new setup')).toBeNull();
  });

  it('opens the new setup only when the server has none of the three', async () => {
    accountOnServer({ crossSigning: false });
    await clickEnable();

    expect(screen.getByRole('dialog').textContent).toBe('new setup');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens nothing and says so when the server cannot answer', async () => {
    accountOnServer({ crossSigning: new Error('keys/query failed') });
    await clickEnable();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      "Could not check your account's encryption setup on the server. Try again."
    );
    cleanup();

    // A backup check that fails is no proof that there is no backup either.
    accountOnServer({
      crossSigning: false,
      backup: new MatrixError({ errcode: 'M_UNKNOWN', error: 'Internal error' }, 500),
    });
    await clickEnable();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('asks the server again at Continue after Enable, and shows the warning for a setup made meanwhile', async () => {
    accountOnServer({ crossSigning: false });
    await clickEnable();
    expect(screen.getByRole('dialog').dataset.confirmFresh).toBe('true');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Found existing' }));
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByText('new setup')).toBeNull();
  });

  it('sets up without asking again once the reset warning is confirmed', async () => {
    accountOnServer({ crossSigning: true });
    render(<SecuritySettings trust={{ ...UNKNOWN_HERE, crossSigning: true }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));
    });
    expect(screen.getByRole('dialog').dataset.confirmFresh).toBe('false');
  });

  it('keeps Reset behind the warning when this session knows the keys', async () => {
    const { userHasCrossSigningKeys } = accountOnServer({ crossSigning: true });
    render(<SecuritySettings trust={{ ...UNKNOWN_HERE, crossSigning: true }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    });

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(userHasCrossSigningKeys).not.toHaveBeenCalled();
  });
});

describe('SecuritySettings recovery password tile', () => {
  const KEY = { keyId: 'k', keyContent: {}, hasPassphrase: true };
  let listener: ((event: { getType: () => string }) => void) | undefined;
  const withStatus = (ready: boolean) => {
    const status = { ready };
    client.current = {
      getCrypto: () => ({ getSecretStorageStatus: vi.fn(async () => ({ ...status })) }),
      on: vi.fn((_event: string, fn: typeof listener) => (listener = fn)),
      off: vi.fn(),
    };
    return status;
  };
  const renderTile = async () => {
    await act(async () => {
      render(<SecuritySettings trust={{ ...UNKNOWN_HERE, crossSigning: true }} />);
    });
  };

  it('offers Change for an account with a recovery password', async () => {
    withStatus(true);
    recovery.current = { kind: 'ready', key: KEY };
    await renderTile();
    expect(screen.getByText('Recovery password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    });
    expect(screen.getByRole('dialog').textContent).toBe('change password');
  });

  it('offers Set recovery password for an account with a recovery key only', async () => {
    withStatus(true);
    recovery.current = { kind: 'ready', key: { ...KEY, hasPassphrase: false } };
    await renderTile();
    expect(screen.getByRole('button', { name: 'Set recovery password' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('shows nothing without a secret storage key or before the session is verified', async () => {
    withStatus(true);
    recovery.current = { kind: 'ready', key: null };
    await renderTile();
    expect(screen.queryByText('Recovery password')).toBeNull();
    cleanup();
    recovery.current = { kind: 'locked', key: KEY };
    await renderTile();
    expect(screen.queryByText('Recovery password')).toBeNull();
  });

  it('warns when the recovery password does not cover every encryption key', async () => {
    withStatus(false);
    recovery.current = { kind: 'ready', key: KEY };
    await renderTile();
    expect(
      screen.getByText('Your recovery password does not cover every encryption key yet.')
    ).toBeTruthy();
  });

  it('clears the warning when the cross-signing secrets arrive in account data', async () => {
    const status = withStatus(false);
    recovery.current = { kind: 'ready', key: KEY };
    await renderTile();
    expect(screen.getByRole('alert')).toBeTruthy();

    status.ready = true;
    await act(async () => listener?.({ getType: () => 'm.cross_signing.master' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
