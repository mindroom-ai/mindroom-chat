// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadBadge } from './ThreadBadge';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import type { ThreadBadgeViewModel } from '../event-store/threads/types';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  ThreadIndicator: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock('../messages/ThreadIndicator', () => ({ ThreadIndicator: mocks.ThreadIndicator }));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: mocks.read }),
}));

const ROOM_ID = '!room:example.org';
const room = { roomId: ROOM_ID, client: {}, myUserId: '@me:example.org' } as unknown as Room;

const model = (isUnread: boolean): ThreadBadgeViewModel => ({
  id: { roomId: ROOM_ID, threadRootId: '$root' },
  replyCount: 11,
  isResolved: false,
  isUnread,
});

const signals = (newCount: number, mentionedMe = false) =>
  ({ newCount, mentionedMe, newSenderIds: [], automation: false } satisfies ThreadSignals);

/** The index as it holds the thread, or without it. */
const storeWithEntry = (indexed: boolean) => {
  const store = createStore();
  const snapshot = emptyCrossRoomThreadIndexSnapshot();
  if (indexed) {
    const key = getCrossRoomThreadIndexKey(ROOM_ID, '$root');
    snapshot.entries.set(key, {
      key,
      roomId: ROOM_ID,
      threadRootId: '$root',
    } as CrossRoomThreadIndexEntry);
  }
  store.set(crossRoomThreadIndexAtom, snapshot);
  return store;
};

const renderedUnread = (isUnread: boolean, indexed = true) => {
  mocks.read.mockClear();
  render(
    <Provider store={storeWithEntry(indexed)}>
      <ThreadBadge model={model(isUnread)} room={room} onClick={vi.fn()} />
    </Provider>
  );
  return mocks.ThreadIndicator.mock.lastCall?.[0]?.unread;
};

describe('ThreadBadge unread state', () => {
  beforeEach(() => mocks.read.mockReturnValue(signals(4)));
  afterEach(() => {
    cleanup();
    mocks.read.mockReset();
    mocks.ThreadIndicator.mockClear();
  });

  it('reads no signals for a read thread, even when they count new replies', () => {
    expect(renderedUnread(false)).toBeUndefined();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('counts the new replies of an unread thread from its signals', () => {
    expect(renderedUnread(true)).toEqual({
      newCount: 4,
      newCountAtLeast: false,
      mentionsMe: false,
    });
    expect(mocks.read).toHaveBeenCalledWith(
      room,
      expect.objectContaining({ threadRootId: '$root' }),
      '@me:example.org',
      expect.any(Number)
    );
  });

  it('tells a mention and a count the signals may cut short', () => {
    mocks.read.mockReturnValue(signals(40, true));

    expect(renderedUnread(true)).toEqual({ newCount: 40, newCountAtLeast: true, mentionsMe: true });
  });

  it('is unread with no count until the thread index holds the thread', () => {
    expect(renderedUnread(true, false)).toEqual({ newCount: 0, mentionsMe: false });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('is unread with no count when the signals count none', () => {
    mocks.read.mockReturnValue(signals(0));

    expect(renderedUnread(true)?.newCount).toBe(0);
  });
});
