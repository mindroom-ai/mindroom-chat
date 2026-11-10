// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { RoomStateEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
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

// Joined rooms by ID; whether each has `m.room.encryption` state.
const rooms = new Map<string, { encrypted: boolean }>();
const ENCRYPTED_ROOM = '!secret:example.org';
const PLAIN_ROOM = '!lobby:example.org';

let client: EventEmitter;

const useAccount = (userId: string, crypto: object | null = {}) => {
  client = Object.assign(new EventEmitter(), {
    getCrypto: () => crypto,
    getSafeUserId: () => userId,
    getRoom: (roomId: string) => {
      const room = rooms.get(roomId);
      return room ? { roomId, hasEncryptionStateEvent: () => room.encrypted } : null;
    },
  });
  vi.mocked(useMatrixClient).mockReturnValue(
    client as unknown as ReturnType<typeof useMatrixClient>
  );
};

const setup = (
  state: RecoveryState,
  config: ClientConfig = {},
  joined: string[] = [ENCRYPTED_ROOM]
) => {
  const store = createStore();
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: joined });
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
  rooms.clear();
  rooms.set(ENCRYPTED_ROOM, { encrypted: true });
  rooms.set(PLAIN_ROOM, { encrypted: false });
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

  it('prompts nothing while no joined room is encrypted', async () => {
    const locked = setup(LOCKED, {}, []);
    await act(async () => {});
    expect(locked.store.get(recoveryDialogAtom)).toBeUndefined();
    cleanup();
    const none = setup(NONE, {}, [PLAIN_ROOM]);
    await act(async () => {});
    expect(none.store.get(recoveryDialogAtom)).toBeUndefined();
    expect(hasServerEncryptionSetup).not.toHaveBeenCalled();
  });

  it('opens Set up once the account joins its first encrypted room', async () => {
    const { store } = setup(NONE, {}, [PLAIN_ROOM]);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
    await act(async () => store.set(allRoomsAtom, { type: 'PUT', roomId: ENCRYPTED_ROOM }));
    expect(store.get(recoveryDialogAtom)).toBe('setup');
  });

  it('opens Unlock once a joined room turns encryption on', async () => {
    const { store } = setup(LOCKED, {}, [PLAIN_ROOM]);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
    rooms.set(PLAIN_ROOM, { encrypted: true });
    await act(async () => {
      client.emit(RoomStateEvent.Events, { getType: () => 'm.room.encryption' }, {}, null);
    });
    expect(store.get(recoveryDialogAtom)).toBe('unlock');
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

  it('encryption off by policy prompts nothing; only one of the two settings off still prompts', async () => {
    const off = { createRoom: { showEncryptionOption: false, defaultEncryption: false } };
    const locked = setup(LOCKED, off);
    await act(async () => {});
    expect(locked.store.get(recoveryDialogAtom)).toBeUndefined();
    cleanup();
    const none = setup(NONE, off);
    await act(async () => {});
    expect(none.store.get(recoveryDialogAtom)).toBeUndefined();
    expect(hasServerEncryptionSetup).not.toHaveBeenCalled();
    for (const createRoom of [
      { showEncryptionOption: false, defaultEncryption: true },
      { showEncryptionOption: true, defaultEncryption: false },
    ]) {
      for (const [state, dialog] of [
        [LOCKED, 'unlock'],
        [NONE, 'setup'],
      ] as const) {
        cleanup();
        resetPromptedAccountsForTests();
        const oneOff = setup(state, { createRoom });
        await act(async () => {});
        expect(oneOff.store.get(recoveryDialogAtom)).toBe(dialog);
      }
    }
  });

  it('does nothing without crypto', async () => {
    useAccount('@alice:example.org', null);
    const { store } = setup(LOCKED);
    await act(async () => {});
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('never overrides a dialog that is already open', async () => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [ENCRYPTED_ROOM] });
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
