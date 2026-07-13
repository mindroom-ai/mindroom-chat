import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { buildRoomFolderNavRows, collectRoomIdsByOrderKey } from './roomFolderNavRows';

const makeMatrixClient = () => {
  const rooms = new Map([
    ['!alpha:example.org', { name: 'Alpha', getLastActiveTimestamp: () => 10 }],
    ['!beta:example.org', { name: 'Beta', getLastActiveTimestamp: () => 30 }],
    ['!gamma:example.org', { name: 'Gamma', getLastActiveTimestamp: () => 20 }],
    [
      '!a-space:example.org',
      {
        name: 'A Space',
        getLastActiveTimestamp: () => 0,
        getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => [] }) }),
      },
    ],
    [
      '!z-space:example.org',
      {
        name: 'Z Space',
        getLastActiveTimestamp: () => 0,
        getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => [] }) }),
      },
    ],
  ]);
  return { getRoom: (roomId: string) => rooms.get(roomId) } as unknown as MatrixClient;
};

describe('room folder navigation rows', () => {
  it('shows folders in account order and keeps unassigned rooms in Rooms', () => {
    const rows = buildRoomFolderNavRows(
      makeMatrixClient(),
      ['!gamma:example.org', '!alpha:example.org', '!beta:example.org'],
      [],
      new Map(),
      [
        { id: 'work', name: 'Work', roomIds: ['!beta:example.org'] },
        { id: 'empty', name: 'Empty', roomIds: ['!missing:example.org'] },
      ],
      {},
      new Set(),
      new Map()
    );

    expect(
      rows.map((row) => (row.type === 'header' ? row.folder?.name ?? 'Rooms' : row.roomId))
    ).toEqual([
      'Work',
      '!beta:example.org',
      'Empty',
      'Rooms',
      '!alpha:example.org',
      '!gamma:example.org',
    ]);
  });

  it('keeps unread and selected rooms visible in a collapsed folder by activity', () => {
    const folderCategory = makeNavCategoryId('home', 'room-folder-work');
    const rows = buildRoomFolderNavRows(
      makeMatrixClient(),
      ['!alpha:example.org', '!beta:example.org', '!gamma:example.org'],
      [],
      new Map(),
      [
        {
          id: 'work',
          name: 'Work',
          roomIds: ['!alpha:example.org', '!beta:example.org', '!gamma:example.org'],
        },
      ],
      {},
      new Set([folderCategory]),
      new Map([['!gamma:example.org', { total: 1, highlight: 0, from: null }]]),
      '!beta:example.org'
    );

    expect(
      rows
        .filter((row) => row.type === 'room')
        .map((row) => (row.type === 'room' ? row.roomId : undefined))
    ).toEqual(['!beta:example.org', '!gamma:example.org']);

    const expandedRows = buildRoomFolderNavRows(
      makeMatrixClient(),
      ['!alpha:example.org', '!beta:example.org', '!gamma:example.org'],
      [],
      new Map(),
      [
        {
          id: 'work',
          name: 'Work',
          roomIds: ['!alpha:example.org', '!beta:example.org', '!gamma:example.org'],
        },
      ],
      {},
      new Set(),
      new Map()
    );
    expect(collectRoomIdsByOrderKey(expandedRows).get('folder:work')).toEqual([
      '!alpha:example.org',
      '!beta:example.org',
      '!gamma:example.org',
    ]);
  });

  it('flattens Matrix spaces into sections while preserving private folder placement', () => {
    const mx = makeMatrixClient();
    const rows = buildRoomFolderNavRows(
      mx,
      ['!alpha:example.org', '!beta:example.org', '!gamma:example.org'],
      ['!z-space:example.org', '!a-space:example.org'],
      new Map([
        ['!alpha:example.org', new Set(['!a-space:example.org'])],
        ['!beta:example.org', new Set(['!a-space:example.org', '!z-space:example.org'])],
      ]),
      [{ id: 'work', name: 'Work', roomIds: ['!alpha:example.org'] }],
      {},
      new Set(),
      new Map()
    );

    expect(
      rows.map((row) =>
        row.type === 'room'
          ? `${row.categoryKind}:${row.roomId}`
          : `${row.categoryKind}:${row.folder?.name ?? row.spaceId ?? 'Rooms'}`
      )
    ).toEqual([
      'folder:Work',
      'folder:!alpha:example.org',
      'space:!a-space:example.org',
      'space:!alpha:example.org',
      'space:!beta:example.org',
      'space:!z-space:example.org',
      'space:!beta:example.org',
      'unfiled:Rooms',
      'unfiled:!gamma:example.org',
    ]);
  });

  it('keeps rooms unfiled when their only parents are not in the current Space list', () => {
    const rows = buildRoomFolderNavRows(
      makeMatrixClient(),
      ['!alpha:example.org'],
      [],
      new Map([['!alpha:example.org', new Set(['!left-space:example.org'])]]),
      [],
      {},
      new Set(),
      new Map()
    );

    expect(
      rows.map((row) =>
        row.type === 'room' ? `${row.categoryKind}:${row.roomId}` : row.categoryKind
      )
    ).toEqual(['unfiled', 'unfiled:!alpha:example.org']);
  });

  it('applies the account-data order independently inside each expanded group', () => {
    const rows = buildRoomFolderNavRows(
      makeMatrixClient(),
      ['!alpha:example.org', '!beta:example.org', '!gamma:example.org'],
      [],
      new Map(),
      [{ id: 'work', name: 'Work', roomIds: ['!alpha:example.org', '!beta:example.org'] }],
      {
        'folder:work': ['!beta:example.org', '!alpha:example.org'],
        unfiled: ['!gamma:example.org'],
      },
      new Set(),
      new Map()
    );

    expect(
      rows
        .filter((row) => row.type === 'room')
        .map((row) => (row.type === 'room' ? `${row.roomOrderKey}:${row.roomId}` : undefined))
    ).toEqual([
      'folder:work:!beta:example.org',
      'folder:work:!alpha:example.org',
      'unfiled:!gamma:example.org',
    ]);
  });
});
