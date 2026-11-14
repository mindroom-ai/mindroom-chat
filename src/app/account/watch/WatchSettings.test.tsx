// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchDevice, WatchStatus } from '../../native/nativeWatch';
import { AppleWatch } from './WatchSettings';

const native = vi.hoisted(() => ({
  available: true,
  status: { paired: true, installed: true, reachable: true } as WatchStatus,
  signedIn: undefined as ((device: WatchDevice) => void) | undefined,
  signOut: vi.fn(async () => undefined),
  send: vi.fn(async () => undefined),
  sendSecrets: vi.fn(async () => undefined),
}));
vi.mock('../../native/nativeWatch', () => ({
  isNativeWatchAvailable: () => native.available,
  getWatchStatus: async () => native.status,
  sendWatchCredentials: native.send,
  sendWatchSecrets: native.sendSecrets,
  signOutWatch: native.signOut,
  onWatchSignedIn: async (listener: (device: WatchDevice) => void) => {
    native.signedIn = listener;
    return () => {
      native.signedIn = undefined;
    };
  },
}));

const flow = vi.hoisted(() => ({
  connect: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('./connectWatch', () => ({ connectWatch: flow.connect, verifyWatch: flow.verify }));

const server = vi.hoisted(() => {
  const state = {
    deleteMultipleDevices: vi.fn(async () => ({})),
    crossSigned: true,
  };
  // One client, as the app's context gives it.
  const client = {
    getSafeUserId: () => '@bas:mindroom.chat',
    deleteMultipleDevices: state.deleteMultipleDevices,
    getCrypto: () => ({
      getDeviceVerificationStatus: async () => ({ crossSigningVerified: state.crossSigned }),
    }),
  };
  return Object.assign(state, { client });
});
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => server.client,
}));
vi.mock('../uia/useAuthenticatedAction', () => ({
  useAuthenticatedAction: () => ({
    run: <T,>(request: () => Promise<T>) => request(),
    prompt: null,
  }),
}));
vi.mock('../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    after?: React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {after}
    </div>
  ),
}));

const renderSettings = async () => {
  render(<AppleWatch requestClose={() => undefined} />);
  await act(async () => undefined);
};

const connectThenSignIn = async (device = { userId: '@bas:mindroom.chat', deviceId: 'WATCH' }) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  });
  await act(async () => {
    native.signedIn?.(device);
  });
};

describe('AppleWatch', () => {
  beforeEach(() => {
    server.crossSigned = true;
    native.available = true;
    native.status = { paired: true, installed: true, reachable: true };
    flow.connect.mockResolvedValue({ kind: 'sent' });
    flow.verify.mockResolvedValue('verified');
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing outside the iOS app', async () => {
    native.available = false;
    const { container } = render(<AppleWatch requestClose={() => undefined} />);
    await act(async () => undefined);
    expect(container.textContent).toBe('');
  });

  it('says when no watch is paired', async () => {
    native.status = { paired: false, installed: false, reachable: false };
    await renderSettings();
    expect(screen.getByText('No Apple Watch is paired with this iPhone.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('still disconnects a watch that is no longer paired', async () => {
    native.status = {
      paired: false,
      installed: false,
      reachable: false,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    };
    await renderSettings();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('verifies again a connected watch the account has not cross-signed', async () => {
    server.crossSigned = false;
    native.status = {
      ...native.status,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    };
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    expect(flow.verify).toHaveBeenCalledWith(expect.anything(), 'WATCH', native.sendSecrets);
  });

  it('offers no Verify for a cross-signed watch', async () => {
    native.status = {
      ...native.status,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    };
    await renderSettings();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
  });

  it('says to install the watch app', async () => {
    native.status = { paired: true, installed: false, reachable: false };
    await renderSettings();
    expect(
      screen.getByText('Install MindRoom on your Apple Watch from the Watch app on this iPhone.')
    ).toBeTruthy();
  });

  it('connects, then verifies the device the watch reports', async () => {
    await renderSettings();
    expect(screen.getByText('Not connected.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(flow.connect).toHaveBeenCalled();
    expect(screen.getByText('Open MindRoom on your Apple Watch to finish.')).toBeTruthy();

    native.status = {
      ...native.status,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    };
    await act(async () => {
      native.signedIn?.({ userId: '@bas:mindroom.chat', deviceId: 'WATCH' });
    });
    expect(flow.verify).toHaveBeenCalledWith(expect.anything(), 'WATCH', native.sendSecrets);
    expect(screen.getByText('Connected as WATCH.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('offers no second Connect while the watch signs in', async () => {
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveProperty('disabled', true);
  });

  it('ignores a sign-in of another account', async () => {
    await renderSettings();
    await connectThenSignIn({ userId: '@other:mindroom.chat', deviceId: 'X' });
    expect(flow.verify).not.toHaveBeenCalled();
  });

  it('ignores a sign-in it did not start', async () => {
    // A fresh module: the connects other tests started do not count here.
    vi.resetModules();
    const { AppleWatch: FreshSettings } = await import('./WatchSettings');
    render(<FreshSettings requestClose={() => undefined} />);
    await act(async () => undefined);
    await act(async () => {
      native.signedIn?.({ userId: '@bas:mindroom.chat', deviceId: 'WATCH' });
    });
    expect(flow.verify).not.toHaveBeenCalled();
  });

  it('says when verifying fails', async () => {
    flow.verify.mockRejectedValue(new Error('NO_WATCH'));
    await renderSettings();
    await connectThenSignIn();
    expect(screen.getByText('Could not connect: NO_WATCH')).toBeTruthy();
  });

  it('shows why connecting failed', async () => {
    flow.connect.mockResolvedValue({ kind: 'unsupported' });
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(screen.getByText('This homeserver cannot sign in an Apple Watch.')).toBeTruthy();
  });

  it('says the watch stays unverified without cross-signing keys', async () => {
    flow.verify.mockResolvedValue('no-cross-signing');
    await renderSettings();
    await connectThenSignIn();
    expect(
      screen.getByText(
        'The watch is connected but unverified: set up encryption on this iPhone to verify it.'
      )
    ).toBeTruthy();
  });

  it('sends the keys again once there is a key backup', async () => {
    flow.verify.mockResolvedValue('no-backup');
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    native.status = {
      ...native.status,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    };
    await act(async () => {
      native.signedIn?.({ userId: '@bas:mindroom.chat', deviceId: 'WATCH' });
    });
    flow.verify.mockResolvedValue('verified');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    expect(flow.verify).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
  });

  it('says when there is no key backup to share', async () => {
    flow.verify.mockResolvedValue('no-backup');
    await renderSettings();
    await connectThenSignIn();
    expect(
      screen.getByText(
        'The watch is verified, but it cannot read messages from before it was connected: turn on key backup on this iPhone.'
      )
    ).toBeTruthy();
  });

  it('disconnects the watch', async () => {
    native.status = {
      paired: true,
      installed: true,
      reachable: true,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    };
    await renderSettings();
    native.status = { paired: true, installed: true, reachable: true };
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });
    expect(server.deleteMultipleDevices).toHaveBeenCalledWith(['WATCH'], undefined);
    expect(native.signOut).toHaveBeenCalled();
    expect(screen.getByText('Not connected.')).toBeTruthy();
  });
});
