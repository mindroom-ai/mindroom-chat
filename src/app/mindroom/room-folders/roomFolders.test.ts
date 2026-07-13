import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  ROOM_FOLDERS_ACCOUNT_DATA_TYPE,
  addRoomFolder,
  deleteRoomFolder,
  enqueueRoomFoldersMutation,
  makeRoomFoldersAccountData,
  moveRoomToFolder,
  renameRoomFolder,
  sanitizeRoomFolders,
} from './roomFolders';

describe('room folder account data', () => {
  it('sanitizes malformed folders and assigns a room to its first folder only', () => {
    expect(
      sanitizeRoomFolders({
        folders: [
          {
            id: 'work',
            name: ' Work ',
            room_ids: ['!a:example.org', '!a:example.org', 7],
            future: true,
          },
          {
            id: 'later',
            name: 'Later',
            room_ids: ['!a:example.org', '!b:example.org'],
          },
          { id: 'work', name: 'Duplicate', room_ids: [] },
          { id: '', name: 'Invalid', room_ids: [] },
          null,
        ],
      })
    ).toEqual([
      { id: 'work', name: 'Work', roomIds: ['!a:example.org'], future: true },
      { id: 'later', name: 'Later', roomIds: ['!b:example.org'] },
    ]);
  });

  it('preserves unknown fields and a newer schema marker while writing canonical content', () => {
    expect(
      makeRoomFoldersAccountData({ future_top_level: 'keep', version: 99 }, [
        { id: 'work', name: 'Work', roomIds: ['!a:example.org'], future_folder: 4 },
      ])
    ).toEqual({
      future_top_level: 'keep',
      version: 99,
      folders: [
        {
          id: 'work',
          name: 'Work',
          room_ids: ['!a:example.org'],
          future_folder: 4,
        },
      ],
    });
  });

  it('leaves the latest state untouched when a queued move targets a deleted folder', () => {
    const folders = [{ id: 'current', name: 'Current', roomIds: ['!room:example.org'] }];

    expect(moveRoomToFolder(folders, '!room:example.org', 'deleted')).toBe(folders);
  });

  it('creates, renames, moves, unfiles, and deletes folders without dropping rooms', () => {
    let folders = addRoomFolder([], { id: 'work', name: ' Work ' });
    folders = addRoomFolder(folders, { id: 'personal', name: 'Personal' });
    folders = moveRoomToFolder(folders, '!room:example.org', 'work');
    folders = moveRoomToFolder(folders, '!room:example.org', 'personal');
    folders = renameRoomFolder(folders, 'personal', ' Friends ');

    expect(folders).toEqual([
      { id: 'work', name: 'Work', roomIds: [] },
      { id: 'personal', name: 'Friends', roomIds: ['!room:example.org'] },
    ]);

    folders = moveRoomToFolder(folders, '!room:example.org');
    expect(folders[1].roomIds).toEqual([]);
    expect(deleteRoomFolder(folders, 'personal')).toEqual([
      { id: 'work', name: 'Work', roomIds: [] },
    ]);
  });

  it('serializes quick writes and re-reads the latest echoed content', async () => {
    let content: Record<string, unknown> = { future: 'keep', folders: [] };
    let releaseFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const setAccountData = vi
      .fn()
      .mockImplementationOnce(async (_type: string, next: Record<string, unknown>) => {
        content = next;
        await firstWrite;
      })
      .mockImplementationOnce(async (_type: string, next: Record<string, unknown>) => {
        content = next;
      });
    const mx = {
      getAccountData: vi.fn(() => ({ getContent: () => content })),
      setAccountData,
    } as unknown as MatrixClient;

    const create = enqueueRoomFoldersMutation(mx, (folders) =>
      addRoomFolder(folders, { id: 'work', name: 'Work' })
    );
    const move = enqueueRoomFoldersMutation(mx, (folders) =>
      moveRoomToFolder(folders, '!room:example.org', 'work')
    );

    await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledTimes(1));
    releaseFirst?.();
    await Promise.all([create, move]);

    expect(setAccountData).toHaveBeenCalledTimes(2);
    expect(setAccountData).toHaveBeenLastCalledWith(ROOM_FOLDERS_ACCOUNT_DATA_TYPE, {
      future: 'keep',
      version: 1,
      folders: [{ id: 'work', name: 'Work', room_ids: ['!room:example.org'] }],
    });
  });
});
