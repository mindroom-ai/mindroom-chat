// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import {
  EncryptionRecoveryPrompt,
  resetPromptedAccountsForTests,
} from './EncryptionRecoveryPrompt';
import { recoveryDialogAtom } from './recoveryDialog';
import { useRecoveryState, type RecoveryState } from './recoveryState';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('./recoveryState', () => ({ useRecoveryState: vi.fn() }));
vi.mock('../devices/serverEncryptionSetup', () => ({ hasServerEncryptionSetup: vi.fn() }));

const KEY = { keyId: 'key1', keyContent: {}, hasPassphrase: true };
const LOCKED: RecoveryState = { kind: 'locked', key: KEY };
const NONE: RecoveryState = { kind: 'none' };

const useAccount = (userId: string, crypto: object | null = {}) =>
  vi.mocked(useMatrixClient).mockReturnValue({
    getCrypto: () => crypto,
    getSafeUserId: () => userId,
  } as unknown as ReturnType<typeof useMatrixClient>);

const setup = (state: RecoveryState, config: ClientConfig = {}) => {
  const store = createStore();
  const ui = (config: ClientConfig) => (
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        <EncryptionRecoveryPrompt />
      </ClientConfigProvider>
    </Provider>
  );
  vi.mocked(useRecoveryState).mockReturnValue(state);
  const view = render(ui(config));
  return {
    store,
    show: async (next: RecoveryState) => {
      vi.mocked(useRecoveryState).mockReturnValue(next);
      view.rerender(ui(config));
      await act(async () => {});
    },
  };
};

beforeEach(() => {
  resetPromptedAccountsForTests();
  useAccount('@alice:example.org');
  vi.mocked(hasServerEncryptionSetup).mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('EncryptionRecoveryPrompt', () => {
  it('opens Unlock once for a locked account', async () => {
    const { store, show } = setup(LOCKED);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBe('unlock');
    store.set(recoveryDialogAtom, undefined);
    await show({ ...LOCKED });
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('opens Set up for an account without encryption', async () => {
    const { store } = setup(NONE);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBe('setup');
  });

  it('no Set up when the server says the account has encryption set up', async () => {
    vi.mocked(hasServerEncryptionSetup).mockResolvedValue(true);
    const { store } = setup(NONE);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('no Set up when the server cannot answer', async () => {
    vi.mocked(hasServerEncryptionSetup).mockRejectedValue(new Error('offline'));
    const { store } = setup(NONE);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('never prompts for unknown or other', async () => {
    const { store, show } = setup({ kind: 'unknown' });
    await show({ kind: 'other' });
    await show({ kind: 'ready', key: KEY });
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
    expect(hasServerEncryptionSetup).not.toHaveBeenCalled();
  });

  it('a session that was verified is not prompted when it turns locked, as during a reset', async () => {
    const { store, show } = setup({ kind: 'ready', key: KEY });
    await show(LOCKED);
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('promptAtStart false prompts nothing', async () => {
    const config = { encryptionRecovery: { promptAtStart: false } } as ClientConfig;
    const locked = setup(LOCKED, config);
    await act(async () => {});
    expect(locked.store.get(recoveryDialogAtom)).toBeUndefined();
    cleanup();
    const none = setup(NONE, config);
    await act(async () => {});
    expect(none.store.get(recoveryDialogAtom)).toBeUndefined();
    expect(hasServerEncryptionSetup).not.toHaveBeenCalled();
  });

  it('does nothing without crypto', async () => {
    useAccount('@alice:example.org', null);
    const { store } = setup(LOCKED);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('never overrides a dialog that is already open', async () => {
    const store = createStore();
    store.set(recoveryDialogAtom, 'change');
    vi.mocked(useRecoveryState).mockReturnValue(LOCKED);
    render(
      <Provider store={store}>
        <ClientConfigProvider value={{}}>
          <EncryptionRecoveryPrompt />
        </ClientConfigProvider>
      </Provider>
    );
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBe('change');
  });

  it('none then locked while the server check is pending opens Unlock', async () => {
    let answer: (hasSetup: boolean) => void = () => {};
    vi.mocked(hasServerEncryptionSetup).mockReturnValue(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      })
    );
    const { store, show } = setup(NONE);
    await show(LOCKED);
    expect(store.get(recoveryDialogAtom)).toBe('unlock');
    store.set(recoveryDialogAtom, undefined);
    answer(false);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('a settled server check that says encryption is set up does not prompt again when the state returns to none', async () => {
    vi.mocked(hasServerEncryptionSetup).mockResolvedValue(true);
    const { store, show } = setup(NONE);
    await act(async () => {});
    await show({ kind: 'other' });
    await show(NONE);
    expect(hasServerEncryptionSetup).toHaveBeenCalledTimes(1);
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('another account is prompted once; the first is not prompted again', async () => {
    const { store, show } = setup(LOCKED);
    await act(async () => {});
    store.set(recoveryDialogAtom, undefined);
    useAccount('@bob:example.org');
    await show({ ...LOCKED });
    expect(store.get(recoveryDialogAtom)).toBe('unlock');
    store.set(recoveryDialogAtom, undefined);
    useAccount('@alice:example.org');
    await show({ ...LOCKED });
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });
});
