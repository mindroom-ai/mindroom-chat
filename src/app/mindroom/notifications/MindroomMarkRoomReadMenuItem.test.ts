import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { state, markRoomAndThreadsAsReadMock } = vi.hoisted(() => ({
  state: {
    hideActivity: false,
    mx: { clientId: 'mx' },
    unread: true,
  },
  markRoomAndThreadsAsReadMock: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    Icons: {
      CheckTwice: 'CheckTwice',
    },
    MenuItem: ({
      children,
      disabled,
      onClick,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => reactModule.createElement('button', { disabled, onClick, type: 'button' }, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => state.mx,
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [state.hideActivity],
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../state/hooks/unread', () => ({
  useRoomUnread: () => state.unread,
}));

vi.mock('../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('./readReceipts', () => ({
  markRoomAndThreadsAsRead: markRoomAndThreadsAsReadMock,
}));

const room = { roomId: '!room:example.org' } as Room;

afterEach(() => {
  state.hideActivity = false;
  state.unread = true;
  markRoomAndThreadsAsReadMock.mockReset();
});

describe('MindroomMarkRoomReadMenuItem', () => {
  it('marks the room and its threads as read, then closes the menu', async () => {
    const onClose = vi.fn();
    state.hideActivity = true;
    const { MindroomMarkRoomReadMenuItem } = await import('./MindroomMarkRoomReadMenuItem');
    const renderer = create(
      React.createElement(MindroomMarkRoomReadMenuItem, { room, onClose })
    );
    const button = renderer.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(markRoomAndThreadsAsReadMock).toHaveBeenCalledWith(
      state.mx,
      '!room:example.org',
      true
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the action when the room has no unread state', async () => {
    state.unread = false;
    const { MindroomMarkRoomReadMenuItem } = await import('./MindroomMarkRoomReadMenuItem');
    const renderer = create(
      React.createElement(MindroomMarkRoomReadMenuItem, { room, onClose: vi.fn() })
    );

    expect(renderer.root.findByType('button').props.disabled).toBe(true);
  });
});
