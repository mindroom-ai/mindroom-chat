// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { SecuritySettings } from './SecuritySettings';

const client = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client.current }));
vi.mock('../../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./KeyBackupTile', () => ({ KeyBackupTile: () => null }));
vi.mock('../verification/SecurityOverlay', () => ({
  SecurityOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../verification/ResetVerificationDialog', () => ({
  ResetVerificationDialog: () => <div role="alertdialog">reset warning</div>,
}));
vi.mock('../verification/DeviceVerificationSetup', () => ({
  DeviceVerificationSetup: () => <div role="dialog">new setup</div>,
}));

type ServerState = {
  crossSigning: boolean | Error;
  secretStorageKeyId?: string | null;
  backup?: { version: string } | Error | null;
};

const noBackup = () => new MatrixError({ errcode: 'M_NOT_FOUND', error: 'No backup' }, 404);

/** An account whose server answers as given; this session itself has not seen any of it yet. */
const accountOnServer = ({ crossSigning, secretStorageKeyId = null, backup = null }: ServerState) => {
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
