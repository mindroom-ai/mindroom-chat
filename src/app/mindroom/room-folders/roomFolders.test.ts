import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  ROOM_FOLDERS_ACCOUNT_DATA_TYPE,
  addRoomFolder,
  applyCanonicalRoomOrder,
  deleteRoomFolder,
  enqueueRoomFolderNavigationMutation,
  enqueueRoomFoldersMutation,
  makeFolderRoomOrderKey,
  makeRoomFoldersAccountData,
  moveRoomToFolder,
  removeRoomFromRoomOrder,
  renameRoomFolder,
  sanitizeRoomFolders,
  sanitizeRoomOrder,
  setRoomOrder,
} from './roomFolders';

describe('room folder account data', () => {
  it('uses a deterministic shared base order before applying a persisted override', () => {
    const rooms = new Map([
      ['!alpha-b:example.org', { name: 'Alpha' }],
      ['!beta:example.org', { name: 'Beta' }],
      ['!alpha-a:example.org', { name: 'Alpha' }],
    ]);
    const mx = {
      getRoom: (roomId: string) => rooms.get(roomId),
    } as unknown as MatrixClient;

    expect(
      applyCanonicalRoomOrder(
        mx,
        ['!alpha-b:example.org', '!beta:example.org', '!alpha-a:example.org'],
        ['!beta:example.org']
      )
    ).toEqual(['!beta:example.org', '!alpha-a:example.org', '!alpha-b:example.org']);
  });

  it('preserves native Matrix child order as the shared Space fallback', () => {
    const childEvent = (roomId: string, order: string | undefined, timestamp: number) => ({
      getType: () => 'm.space.child',
      getContent: () => ({ via: ['example.org'], order }),
      getStateKey: () => roomId,
      getTs: () => timestamp,
    });
    const events = [
      childEvent('!alpha-a:example.org', undefined, 1),
      childEvent('!beta:example.org', 'b', 3),
      childEvent('!alpha-b:example.org', 'a', 2),
    ];
    const space = {
      getLiveTimeline: () => ({
        getState: () => ({ getStateEvents: () => events }),
      }),
    };
    const rooms = new Map([
      ['!space:example.org', space],
      ['!alpha-b:example.org', { name: 'Alpha' }],
      ['!beta:example.org', { name: 'Beta' }],
      ['!alpha-a:example.org', { name: 'Alpha' }],
    ]);
    const mx = {
      getRoom: (roomId: string) => rooms.get(roomId),
    } as unknown as MatrixClient;

    expect(
      applyCanonicalRoomOrder(
        mx,
        ['!alpha-a:example.org', '!beta:example.org', '!alpha-b:example.org'],
        ['!beta:example.org'],
        '!space:example.org'
      )
    ).toEqual(['!beta:example.org', '!alpha-b:example.org', '!alpha-a:example.org']);
  });

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

  it('sanitizes per-group room order from the same account-data event', () => {
    expect(
      sanitizeRoomOrder({
        room_order: {
          'folder:work': ['!b:example.org', '!a:example.org', '!b:example.org', 7],
          'space:empty': [],
          invalid: 'not-an-array',
        },
      })
    ).toEqual({
      'folder:work': ['!b:example.org', '!a:example.org'],
    });
  });

  it('preserves unknown fields and a newer schema marker while writing canonical content', () => {
    expect(
      makeRoomFoldersAccountData(
        {
          future_top_level: 'keep',
          version: 99,
          room_order: { future_group_metadata: { keep: true } },
        },
        [{ id: 'work', name: 'Work', roomIds: ['!a:example.org'], future_folder: 4 }],
        { 'folder:work': ['!a:example.org'] }
      )
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
      room_order: {
        future_group_metadata: { keep: true },
        'folder:work': ['!a:example.org'],
      },
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

  it('sets a group order and removes a moved room from stale group overrides', () => {
    let order = setRoomOrder({}, makeFolderRoomOrderKey('work'), [
      '!b:example.org',
      '!a:example.org',
      '!b:example.org',
    ]);
    order = setRoomOrder(order, 'unfiled', ['!c:example.org', '!a:example.org']);

    expect(removeRoomFromRoomOrder(order, '!a:example.org')).toEqual({
      'folder:work': ['!b:example.org'],
      unfiled: ['!c:example.org'],
    });

    expect(
      removeRoomFromRoomOrder(
        {
          'folder:work': ['!a:example.org'],
          'space:team': ['!a:example.org', '!b:example.org'],
        },
        '!a:example.org',
        ['folder:work']
      )
    ).toEqual({
      'space:team': ['!a:example.org', '!b:example.org'],
    });
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

  it('serializes a reordered Home group into Matrix account data', async () => {
    let content: Record<string, unknown> = {
      future: 'keep',
      folders: [{ id: 'work', name: 'Work', room_ids: ['!a:example.org', '!b:example.org'] }],
    };
    const setAccountData = vi.fn(async (_type: string, next: Record<string, unknown>) => {
      content = next;
    });
    const mx = {
      getAccountData: vi.fn(() => ({ getContent: () => content })),
      setAccountData,
    } as unknown as MatrixClient;

    await enqueueRoomFolderNavigationMutation(mx, (state) => ({
      ...state,
      roomOrder: setRoomOrder(state.roomOrder, 'folder:work', ['!b:example.org', '!a:example.org']),
    }));

    expect(setAccountData).toHaveBeenCalledWith(ROOM_FOLDERS_ACCOUNT_DATA_TYPE, {
      future: 'keep',
      version: 1,
      folders: [{ id: 'work', name: 'Work', room_ids: ['!a:example.org', '!b:example.org'] }],
      room_order: {
        'folder:work': ['!b:example.org', '!a:example.org'],
      },
    });
  });
});
