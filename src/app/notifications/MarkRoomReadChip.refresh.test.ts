import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// The Inbox lists the server's notifications with their read flags, so it reloads them once the
// room's receipt has reached the server, not before.
const { receipt } = vi.hoisted(() => {
  let settle: () => void = () => undefined;
  return {
    receipt: {
      promise: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      settle: () => settle(),
    },
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Chip: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
      reactModule.createElement('button', { onClick, type: 'button' }, children),
    Icon: () => null,
    Icons: { CheckTwice: 'CheckTwice' },
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../preferences/useSetting', () => ({ useSetting: () => [false] }));
vi.mock('../preferences/settings', () => ({ settingsAtom: {} }));
vi.mock('./readReceipts', () => ({ markRoomAndThreadsAsRead: () => receipt.promise() }));

describe('MindroomMarkRoomReadChip', () => {
  it('reports the room as marked once its receipt is sent', async () => {
    const { MindroomMarkRoomReadChip } = await import('./MarkRoomReadChip');
    const onMarked = vi.fn();
    const renderer = create(
      React.createElement(MindroomMarkRoomReadChip, { roomId: '!room:example.org', onMarked })
    );

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });
    await act(async () => undefined);
    expect(onMarked).not.toHaveBeenCalled();

    await act(async () => {
      receipt.settle();
    });
    expect(onMarked).toHaveBeenCalledTimes(1);
  });
});
