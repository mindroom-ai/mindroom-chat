import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { state, markRoomAndThreadsAsReadMock } = vi.hoisted(() => ({
  state: {
    hideActivity: false,
    mx: { clientId: 'mx' },
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
      'aria-disabled': ariaDisabled,
      disabled,
      onClick,
    }: {
      children: React.ReactNode;
      'aria-disabled'?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    }) =>
      reactModule.createElement(
        'button',
        { 'aria-disabled': ariaDisabled, disabled, onClick, type: 'button' },
        children
      ),
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

vi.mock('./readReceipts', () => ({
  markRoomAndThreadsAsRead: markRoomAndThreadsAsReadMock,
}));

afterEach(() => {
  state.hideActivity = false;
  markRoomAndThreadsAsReadMock.mockReset();
});

describe('MindroomMarkRoomsReadMenuItem', () => {
  it('marks every listed room and its threads as read, then closes the menu', async () => {
    const onClose = vi.fn();
    state.hideActivity = true;
    const { MindroomMarkRoomsReadMenuItem } = await import('./MindroomMarkRoomsReadMenuItem');
    const renderer = create(
      React.createElement(MindroomMarkRoomsReadMenuItem, {
        roomIds: ['!a:example.org', '!b:example.org'],
        onClose,
      })
    );
    const button = renderer.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(markRoomAndThreadsAsReadMock).toHaveBeenNthCalledWith(
      1,
      state.mx,
      '!a:example.org',
      true
    );
    expect(markRoomAndThreadsAsReadMock).toHaveBeenNthCalledWith(
      2,
      state.mx,
      '!b:example.org',
      true
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows marking threads read when no listed room has room-level unread', async () => {
    const onClose = vi.fn();
    const { MindroomMarkRoomsReadMenuItem } = await import('./MindroomMarkRoomsReadMenuItem');
    const renderer = create(
      React.createElement(MindroomMarkRoomsReadMenuItem, {
        roomIds: ['!a:example.org'],
        onClose,
      })
    );
    const button = renderer.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(button.props.disabled).toBeUndefined();
    expect(button.props['aria-disabled']).not.toBe(true);
    expect(markRoomAndThreadsAsReadMock).toHaveBeenCalledWith(state.mx, '!a:example.org', false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps an empty room list tabbable without sending receipts or closing', async () => {
    const onClose = vi.fn();
    const { MindroomMarkRoomsReadMenuItem } = await import('./MindroomMarkRoomsReadMenuItem');
    const renderer = create(
      React.createElement(MindroomMarkRoomsReadMenuItem, { roomIds: [], onClose })
    );
    const button = renderer.root.findByType('button');

    act(() => button.props.onClick());

    expect(button.props.disabled).toBeUndefined();
    expect(button.props['aria-disabled']).toBe(true);
    expect(markRoomAndThreadsAsReadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
