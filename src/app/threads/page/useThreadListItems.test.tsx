// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { useThreadListItems } from './useThreadListItems';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: mocks.read }),
}));
const room = { roomId: '!r:x' };
const mx = { getSafeUserId: () => '@me:x', getRoom: () => room };
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));

describe('useThreadListItems', () => {
  it('reads the threads again when a room’s unread counts change with no index change', () => {
    mocks.read.mockReturnValue({
      mentionedMe: false,
      newCount: 0,
      newSenderIds: [],
      automation: false,
    });
    const store = createStore();
    const entry = { key: 'k', roomId: '!r:x', threadRootId: '$t' } as CrossRoomThreadIndexEntry;
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([['k', entry]]),
      bootstrapped: true,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    renderHook(() => useThreadListItems(), { wrapper });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    // The sync after a read clears the server's mention count; the index does not change.
    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'PUT',
        unreadInfo: { roomId: '!r:x', total: 0, highlight: 0, from: new Set() },
      } as never)
    );
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});
