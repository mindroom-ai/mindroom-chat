import { describe, expect, it } from 'vitest';
import { placeRoomInOrder, resolveRoomFolderDrop } from './roomFolderDnd';

const roomId = '!room:example.org';

describe('room folder drag and drop', () => {
  it('places a room at the hovered row or appends it to a group header', () => {
    expect(placeRoomInOrder(['!a', '!b', '!c'], '!c', '!a')).toEqual(['!c', '!a', '!b']);
    expect(placeRoomInOrder(['!a', '!b'], '!c')).toEqual(['!a', '!b', '!c']);
  });

  it('moves personal placement without implying Matrix space changes', () => {
    expect(
      resolveRoomFolderDrop(
        roomId,
        { categoryKind: 'folder', parentId: 'work', roomOrderKey: 'folder:work' },
        new Map()
      )
    ).toEqual({ type: 'move-personal', roomId, folderId: 'work' });

    expect(
      resolveRoomFolderDrop(roomId, { categoryKind: 'unfiled', roomOrderKey: 'unfiled' }, new Map())
    ).toEqual({
      type: 'move-personal',
      roomId,
    });
  });

  it('rejects an impossible Rooms drop unless it removes a personal placement', () => {
    const parents = new Map([[roomId, new Set(['!space:example.org'])]]);
    expect(
      resolveRoomFolderDrop(roomId, { categoryKind: 'unfiled', roomOrderKey: 'unfiled' }, parents)
    ).toBeUndefined();
    expect(
      resolveRoomFolderDrop(
        roomId,
        { categoryKind: 'unfiled', roomOrderKey: 'unfiled' },
        parents,
        'work'
      )
    ).toEqual({
      type: 'move-personal',
      roomId,
    });
  });

  it('adds to a new Matrix space and no-ops for existing membership', () => {
    const spaceId = '!space:example.org';
    expect(
      resolveRoomFolderDrop(
        roomId,
        { categoryKind: 'space', parentId: spaceId, roomOrderKey: `space:${spaceId}` },
        new Map()
      )
    ).toEqual({ type: 'add-to-space', roomId, spaceId });

    expect(
      resolveRoomFolderDrop(
        roomId,
        { categoryKind: 'space', parentId: spaceId, roomOrderKey: `space:${spaceId}` },
        new Map([[roomId, new Set([spaceId])]])
      )
    ).toBeUndefined();
  });
});
