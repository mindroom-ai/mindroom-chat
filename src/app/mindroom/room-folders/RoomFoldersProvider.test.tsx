import React from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
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
          <RoomFoldersProvider>
            <Consumer />
          </RoomFoldersProvider>
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
          <RoomFoldersProvider>
            <Consumer />
          </RoomFoldersProvider>
        </MatrixClientProvider>
      );
    });

    act(() => {
      accountDataHandler?.({
        getType: () => ROOM_FOLDERS_ACCOUNT_DATA_TYPE,
        getContent: () => ({
          folders: [{ id: 'synced', name: 'Synced', room_ids: ['!room:example.org'] }],
        }),
      });
    });
    expect(foldersApi?.folders).toEqual([
      { id: 'synced', name: 'Synced', roomIds: ['!room:example.org'] },
    ]);

    act(() => renderer?.unmount());
    expect(removeListener).toHaveBeenCalledWith('accountData', accountDataHandler);
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
          <RoomFoldersProvider>
            <Consumer />
          </RoomFoldersProvider>
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
