// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { recoveryDialogAtom } from '../encryption/recoveryDialog';
import { useRecoveryState, type RecoveryState } from '../encryption/recoveryState';
import { KeyBackupNudge } from './KeyBackupNudge';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../encryption/recoveryState', () => ({ useRecoveryState: vi.fn() }));

const recoveryState = vi.mocked(useRecoveryState);

const KEY = { keyId: 'key1', keyContent: {}, hasPassphrase: true };

const mockClient = (crypto: object | null = {}) =>
  vi.mocked(useMatrixClient).mockReturnValue({
    getCrypto: () => crypto,
    getSafeUserId: () => '@alice:example.org',
  } as unknown as ReturnType<typeof useMatrixClient>);

const renderNudge = (state: RecoveryState, config: ClientConfig = {}) => {
  recoveryState.mockReturnValue(state);
  const store = createStore();
  render(
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        <KeyBackupNudge />
      </ClientConfigProvider>
    </Provider>
  );
  return store;
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('KeyBackupNudge', () => {
  it('shows only while the account has nothing set up', () => {
    mockClient();
    for (const state of [
      { kind: 'unknown' },
      { kind: 'other' },
      { kind: 'locked', key: KEY },
      { kind: 'ready', key: KEY },
    ] as RecoveryState[]) {
      renderNudge(state);
      expect(screen.queryByText('Protect your messages')).toBeNull();
      cleanup();
    }
    renderNudge({ kind: 'none' });
    expect(screen.getByText('Protect your messages')).toBeTruthy();
    expect(screen.getByText(/Set a recovery password so you can still read/)).toBeTruthy();
  });

  it('opens the recovery password setup from its button', async () => {
    mockClient();
    const store = renderNudge({ kind: 'none' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Set up recovery password' }));
    });
    expect(store.get(recoveryDialogAtom)).toBe('setup');
  });

  it('has no dismiss button', () => {
    mockClient();
    renderNudge({ kind: 'none' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('shows nothing without crypto or when encryption is disabled by policy', () => {
    mockClient(null);
    renderNudge({ kind: 'none' });
    expect(screen.queryByText('Protect your messages')).toBeNull();
    cleanup();

    mockClient();
    renderNudge(
      { kind: 'none' },
      { createRoom: { showEncryptionOption: false, defaultEncryption: false } }
    );
    expect(screen.queryByText('Protect your messages')).toBeNull();
    cleanup();

    renderNudge(
      { kind: 'none' },
      { createRoom: { showEncryptionOption: false, defaultEncryption: true } }
    );
    expect(screen.getByText('Protect your messages')).toBeTruthy();
  });
});
