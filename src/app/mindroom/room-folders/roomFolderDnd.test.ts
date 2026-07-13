import { describe, expect, it } from 'vitest';
import { resolveRoomFolderDrop } from './roomFolderDnd';

const roomId = '!room:example.org';

describe('room folder drag and drop', () => {
  it('moves personal placement without implying Matrix space changes', () => {
    expect(
      resolveRoomFolderDrop(roomId, { categoryKind: 'folder', parentId: 'work' }, new Map())
    ).toEqual({ type: 'move-personal', roomId, folderId: 'work' });

    expect(resolveRoomFolderDrop(roomId, { categoryKind: 'unfiled' }, new Map())).toEqual({
      type: 'move-personal',
      roomId,
    });
  });

  it('rejects an impossible Rooms drop unless it removes a personal placement', () => {
    const parents = new Map([[roomId, new Set(['!space:example.org'])]]);
    expect(resolveRoomFolderDrop(roomId, { categoryKind: 'unfiled' }, parents)).toBeUndefined();
    expect(resolveRoomFolderDrop(roomId, { categoryKind: 'unfiled' }, parents, 'work')).toEqual({
      type: 'move-personal',
      roomId,
    });
  });

  it('adds to a new Matrix space and no-ops for existing membership', () => {
    const spaceId = '!space:example.org';
    expect(
      resolveRoomFolderDrop(roomId, { categoryKind: 'space', parentId: spaceId }, new Map())
    ).toEqual({ type: 'add-to-space', roomId, spaceId });

    expect(
      resolveRoomFolderDrop(
        roomId,
        { categoryKind: 'space', parentId: spaceId },
        new Map([[roomId, new Set([spaceId])]])
      )
    ).toBeUndefined();
  });
});
