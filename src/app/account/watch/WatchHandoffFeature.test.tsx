// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WatchThread } from '../../native/nativeWatch';
import { OPENED_FROM_OUTSIDE_STATE } from '../../routes/historyStack';
import { WatchHandoffFeature } from './WatchHandoffFeature';

const state = vi.hoisted(() => ({
  listener: undefined as ((thread: WatchThread) => void) | undefined,
  synced: false,
  joined: new Set<string>(['!room:x']),
  navigateRoom: vi.fn(),
}));
vi.mock('../../native/nativeWatch', () => ({
  onWatchOpenThread: async (listener: (thread: WatchThread) => void) => {
    state.listener = listener;
    return () => {
      state.listener = undefined;
    };
  },
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: state.navigateRoom }),
}));
vi.mock('../../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: state.synced }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) =>
      state.joined.has(roomId) ? { getMyMembership: () => 'join' } : null,
  }),
}));

describe('WatchHandoffFeature', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.synced = false;
  });

  it('opens a handed-off thread once the first sync is done', async () => {
    const view = render(<WatchHandoffFeature />);
    await act(async () => undefined);
    await act(async () => state.listener?.({ roomId: '!room:x', threadId: '$root' }));
    expect(state.navigateRoom).not.toHaveBeenCalled();
    state.synced = true;
    view.rerender(<WatchHandoffFeature />);
    expect(state.navigateRoom).toHaveBeenCalledWith('!room:x', '$root', {
      state: OPENED_FROM_OUTSIDE_STATE,
    });
  });

  it('ignores a room this account is not in', async () => {
    state.synced = true;
    render(<WatchHandoffFeature />);
    await act(async () => undefined);
    await act(async () => state.listener?.({ roomId: '!other:x', threadId: '$root' }));
    expect(state.navigateRoom).not.toHaveBeenCalled();
  });
});
