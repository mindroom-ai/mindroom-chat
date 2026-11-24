// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
  emptyCrossRoomThreadIndexSnapshot,
} from '../threads/cross-room/crossRoomThreadIndex';
import { HomeRecentThreads } from './HomeRecentThreads';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@robin:example.org',
    getRoom: (roomId: string) => (roomId === '!gone' ? null : {}),
  }),
}));
vi.mock('../sidebar/threads/ThreadNavItem', () => ({
  useThreadEntryRow: () => ({ room: {}, relativeTime: 'now', open: vi.fn() }),
}));
vi.mock('./HomeAsk', () => ({ Badge: () => null }));

const NOW = 60_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HomeRecentThreads', () => {
  it('lists a snoozed thread again when its snooze ends, not a minute later', () => {
    const entry = {
      key: '!eng\u0000$plan',
      roomId: '!eng',
      roomName: 'Engineering',
      threadRootId: '$plan',
      summaryText: 'Plan the release',
      lastActivityTs: NOW - 1000,
      snoozedUntilTs: NOW + 20_000,
    } as unknown as CrossRoomThreadIndexEntry;
    const store = createStore();
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([[entry.key, entry]]),
    });
    render(
      <Provider store={store}>
        <HomeRecentThreads />
      </Provider>
    );
    expect(screen.queryByText('Plan the release')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText('Plan the release')).toBeTruthy();
  });

  it('skips entries whose room is not loaded before slicing to 4 rows', () => {
    const makeEntry = (i: number, roomId: string) =>
      ({
        key: `${roomId}\u0000${i}`,
        roomId,
        roomName: 'Room',
        threadRootId: `${i}`,
        summaryText: `Thread ${i}`,
        lastActivityTs: NOW - i * 1000,
      }) as unknown as CrossRoomThreadIndexEntry;
    const list = [
      makeEntry(1, '!gone'),
      makeEntry(2, '!r2'),
      makeEntry(3, '!r3'),
      makeEntry(4, '!r4'),
      makeEntry(5, '!r5'),
    ];
    const store = createStore();
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map(list.map((e) => [e.key, e])),
    });
    render(
      <Provider store={store}>
        <HomeRecentThreads />
      </Provider>
    );
    expect(screen.queryByText('Thread 1')).toBeNull();
    expect(screen.getByText('Thread 5')).toBeTruthy();
  });
});
