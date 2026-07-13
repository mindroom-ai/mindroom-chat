import React from 'react';
import { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RoomFolderMenuItems } from './RoomFolderMenuItems';

const mocks = vi.hoisted(() => ({
  moveRoom: vi.fn(),
}));

vi.mock('./RoomFoldersProvider', () => ({
  useRoomFolders: () => ({
    folders: [
      { id: 'work', name: 'Work', roomIds: ['!room:example.org'] },
      { id: 'later', name: 'Later', roomIds: [] },
    ],
    moveRoom: mocks.moveRoom,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('RoomFolderMenuItems', () => {
  it('exposes the folder choices as a labelled group of pressed buttons', () => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <RoomFolderMenuItems
          room={{ roomId: '!room:example.org' } as unknown as Room}
          requestClose={vi.fn()}
        />
      );
    });

    const group = renderer!.root.findByProps({ role: 'group' });
    expect(renderer!.root.findByProps({ id: group.props['aria-labelledby'] })).toBeTruthy();
    const choices = renderer!.root.findAll(
      (node) => node.type === 'button' && typeof node.props['aria-pressed'] === 'boolean'
    );
    expect(choices).toHaveLength(3);
    expect(choices.map((choice) => choice.props['aria-pressed'])).toEqual([false, true, false]);
  });
});
