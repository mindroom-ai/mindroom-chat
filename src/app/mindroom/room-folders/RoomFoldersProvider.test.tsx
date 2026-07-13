import React from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { ClientStartupProvider } from '../../pages/client/ClientStartupContext';
import { RoomFoldersProvider, useRoomFolders } from './RoomFoldersProvider';
import { ROOM_FOLDERS_ACCOUNT_DATA_TYPE } from './roomFolders';

const mocks = vi.hoisted(() => ({
  randomStr: vi.fn(() => 'stable-folder-id'),
}));

vi.mock('../../utils/common', () => ({
  randomStr: mocks.randomStr,
}));

describe('RoomFoldersProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.randomStr.mockClear();
  });

  it('uses one stable ID for the optimistic and persisted create mutation', async () => {
    const setAccountData = vi.fn().mockResolvedValue(undefined);
    const mx = {
      getAccountData: vi.fn(() => undefined),
      setAccountData,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;
    let foldersApi: ReturnType<typeof useRoomFolders> | undefined;

    function Consumer() {
      foldersApi = useRoomFolders();
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientStartupProvider hasCompletedInitialSync>
            <RoomFoldersProvider>
              <Consumer />
            </RoomFoldersProvider>
          </ClientStartupProvider>
        </MatrixClientProvider>
      );
    });
    await act(async () => {
      await foldersApi?.createFolder('Work');
    });

    expect(mocks.randomStr).toHaveBeenCalledTimes(1);
    expect(foldersApi?.folders).toEqual([{ id: 'stable-folder-id', name: 'Work', roomIds: [] }]);
    expect(setAccountData).toHaveBeenCalledWith(ROOM_FOLDERS_ACCOUNT_DATA_TYPE, {
      version: 1,
      folders: [{ id: 'stable-folder-id', name: 'Work', room_ids: [] }],
    });

    act(() => renderer?.unmount());
  });

  it('subscribes to account-data echoes and removes the exact listener on unmount', () => {
    let accountDataHandler:
      | ((event: { getType: () => string; getContent: () => unknown }) => void)
      | undefined;
    const removeListener = vi.fn();
    const mx = {
      getAccountData: vi.fn(() => undefined),
      setAccountData: vi.fn(),
      on: vi.fn((_event, handler) => {
        accountDataHandler = handler;
      }),
      removeListener,
    } as unknown as MatrixClient;
    let foldersApi: ReturnType<typeof useRoomFolders> | undefined;

    function Consumer() {
      foldersApi = useRoomFolders();
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientStartupProvider hasCompletedInitialSync>
            <RoomFoldersProvider>
              <Consumer />
            </RoomFoldersProvider>
          </ClientStartupProvider>
        </MatrixClientProvider>
      );
    });

    act(() => {
      accountDataHandler?.({
        getType: () => ROOM_FOLDERS_ACCOUNT_DATA_TYPE,
        getContent: () => ({
          folders: [{ id: 'synced', name: 'Synced', room_ids: ['!room:example.org'] }],
          room_order: { 'folder:synced': ['!room:example.org'] },
        }),
      });
    });
    expect(foldersApi?.folders).toEqual([
      { id: 'synced', name: 'Synced', roomIds: ['!room:example.org'] },
    ]);
    expect(foldersApi?.roomOrder).toEqual({
      'folder:synced': ['!room:example.org'],
    });

    act(() => renderer?.unmount());
    expect(removeListener).toHaveBeenCalledWith('accountData', accountDataHandler);
  });

  it('optimistically reorders a Home group and persists it in account data', async () => {
    const initialContent = {
      folders: [
        {
          id: 'work',
          name: 'Work',
          room_ids: ['!a:example.org', '!b:example.org'],
        },
      ],
    };
    const setAccountData = vi.fn().mockResolvedValue(undefined);
    const mx = {
      getAccountData: vi.fn(() => ({ getContent: () => initialContent })),
      setAccountData,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;
    let foldersApi: ReturnType<typeof useRoomFolders> | undefined;

    function Consumer() {
      foldersApi = useRoomFolders();
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientStartupProvider hasCompletedInitialSync>
            <RoomFoldersProvider>
              <Consumer />
            </RoomFoldersProvider>
          </ClientStartupProvider>
        </MatrixClientProvider>
      );
    });

    await act(async () => {
      await foldersApi?.reorderRooms('folder:work', ['!b:example.org', '!a:example.org']);
    });

    expect(foldersApi?.roomOrder).toEqual({
      'folder:work': ['!b:example.org', '!a:example.org'],
    });
    expect(setAccountData).toHaveBeenCalledWith(ROOM_FOLDERS_ACCOUNT_DATA_TYPE, {
      version: 1,
      folders: [
        {
          id: 'work',
          name: 'Work',
          room_ids: ['!a:example.org', '!b:example.org'],
        },
      ],
      room_order: {
        'folder:work': ['!b:example.org', '!a:example.org'],
      },
    });

    act(() => renderer?.unmount());
  });

  it('imports missing device-local Space orders into Matrix account data once', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) =>
        key === 'mindroom.sidebar.roomOrderBySpace:@me:example.org'
          ? '{"!space:example.org":["!b:example.org","!a:example.org"]}'
          : null
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 1,
    } as unknown as Storage);
    const setAccountData = vi.fn().mockResolvedValue(undefined);
    const mx = {
      getUserId: () => '@me:example.org',
      getAccountData: vi.fn(() => undefined),
      setAccountData,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientStartupProvider hasCompletedInitialSync>
            <RoomFoldersProvider>
              <div />
            </RoomFoldersProvider>
          </ClientStartupProvider>
        </MatrixClientProvider>
      );
    });

    await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledTimes(1));
    expect(setAccountData).toHaveBeenCalledWith(ROOM_FOLDERS_ACCOUNT_DATA_TYPE, {
      version: 1,
      folders: [],
      room_order: {
        'space:!space:example.org': ['!b:example.org', '!a:example.org'],
      },
    });
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      'mindroom.sidebar.roomOrderBySpace:@me:example.org'
    );

    act(() => renderer?.unmount());
  });

  it('waits for initial account-data catch-up before migrating a legacy Space order', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) =>
        key === 'mindroom.sidebar.roomOrderBySpace:@me:example.org'
          ? '{"!space:example.org":["!b:example.org","!a:example.org"]}'
          : null
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 1,
    } as unknown as Storage);
    const setAccountData = vi.fn().mockResolvedValue(undefined);
    const mx = {
      getUserId: () => '@me:example.org',
      getAccountData: vi.fn(() => undefined),
      setAccountData,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;
    const renderProvider = (hasCompletedInitialSync: boolean) => (
      <MatrixClientProvider value={mx}>
        <ClientStartupProvider hasCompletedInitialSync={hasCompletedInitialSync}>
          <RoomFoldersProvider>
            <div />
          </RoomFoldersProvider>
        </ClientStartupProvider>
      </MatrixClientProvider>
    );

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(renderProvider(false));
    });
    await act(async () => Promise.resolve());
    expect(setAccountData).not.toHaveBeenCalled();

    act(() => renderer?.update(renderProvider(true)));
    await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledTimes(1));
    expect(localStorage.removeItem).toHaveBeenCalledTimes(1);

    act(() => renderer?.unmount());
  });

  it('queues user navigation writes until initial account-data catch-up completes', async () => {
    const setAccountData = vi.fn().mockResolvedValue(undefined);
    const mx = {
      getAccountData: vi.fn(() => undefined),
      setAccountData,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;
    let foldersApi: ReturnType<typeof useRoomFolders> | undefined;

    function Consumer() {
      foldersApi = useRoomFolders();
      return null;
    }

    const renderProvider = (hasCompletedInitialSync: boolean) => (
      <MatrixClientProvider value={mx}>
        <ClientStartupProvider hasCompletedInitialSync={hasCompletedInitialSync}>
          <RoomFoldersProvider>
            <Consumer />
          </RoomFoldersProvider>
        </ClientStartupProvider>
      </MatrixClientProvider>
    );
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(renderProvider(false));
    });

    let pendingWrite: Promise<void> | undefined;
    act(() => {
      pendingWrite = foldersApi?.reorderRooms('unfiled', ['!b:example.org', '!a:example.org']);
    });
    expect(foldersApi?.roomOrder).toEqual({
      unfiled: ['!b:example.org', '!a:example.org'],
    });
    expect(setAccountData).not.toHaveBeenCalled();

    act(() => renderer?.update(renderProvider(true)));
    await act(async () => pendingWrite);
    expect(setAccountData).toHaveBeenCalledTimes(1);

    act(() => renderer?.unmount());
  });

  it('rolls optimistic state back and exposes an error when persistence fails', async () => {
    const initialContent = {
      folders: [{ id: 'work', name: 'Work', room_ids: [] }],
    };
    const mx = {
      getAccountData: vi.fn(() => ({ getContent: () => initialContent })),
      setAccountData: vi.fn().mockRejectedValue(new Error('offline')),
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MatrixClient;
    let foldersApi: ReturnType<typeof useRoomFolders> | undefined;

    function Consumer() {
      foldersApi = useRoomFolders();
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientStartupProvider hasCompletedInitialSync>
            <RoomFoldersProvider>
              <Consumer />
            </RoomFoldersProvider>
          </ClientStartupProvider>
        </MatrixClientProvider>
      );
    });

    await act(async () => {
      await expect(foldersApi?.renameFolder('work', 'Renamed')).rejects.toThrow('offline');
    });
    expect(foldersApi?.folders).toEqual([{ id: 'work', name: 'Work', roomIds: [] }]);
    expect(foldersApi?.saveError).toBe(true);

    act(() => renderer?.unmount());
  });
});
