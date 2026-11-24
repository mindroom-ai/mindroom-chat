// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUIET_AFTER_MS } from '../../event-store/threads/threadWorkflow';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { useCompactThreadSections } from './useCompactThreadSections';

const readSignals = vi.hoisted(() => vi.fn<() => Record<string, unknown>>(() => ({})));
vi.mock('../cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: readSignals }),
}));

const ROOM_ID = '!room:example.org';
const NOW = 1_000;

/** A room whose state the hook must not read: the records carry the job flags. */
const room = () => {
  const getStateEvents = vi.fn(() => []);
  const value = {
    roomId: ROOM_ID,
    myUserId: '@me:example.org',
    client: {},
    currentState: { getStateEvents },
  } as unknown as Room;
  return { room: value, getStateEvents };
};

const record = (rootId: string, status: Partial<ThreadStatusSnapshot> = {}): ThreadRecord =>
  ({
    roomId: ROOM_ID,
    threadRootId: rootId,
    status: { isStreaming: false, isResolved: false, scheduledTaskCount: 0, tags: [], ...status },
    cache: {},
  } as unknown as ThreadRecord);

const recordsOf = (...items: ThreadRecord[]) =>
  new Map(items.map((item) => [item.threadRootId, item] as const));

const wrapperOf =
  (store: ReturnType<typeof createStore>) =>
  ({ children }: { children: ReactNode }) =>
    <Provider store={store}>{children}</Provider>;

describe('useCompactThreadSections', () => {
  afterEach(() => {
    vi.useRealTimers();
    readSignals.mockReset().mockReturnValue({});
  });

  it('reads nothing while Sections are off', () => {
    const { room: offRoom } = room();
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room: offRoom,
          now: undefined,
          threadRootIds: ['$a'],
          threadRecordMap: recordsOf(record('$a')),
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()) }
    );

    expect(result.current).toBeUndefined();
  });

  it("follows the records' job flags, without reading the agents' jobs state", () => {
    const { room: jobsRoom, getStateEvents } = room();
    const running = recordsOf(
      record('$a'),
      record('$b', { hasBackgroundJob: true }),
      record('$c', { isResolved: true })
    );
    const { result, rerender } = renderHook(
      ({ threadRecordMap }) =>
        useCompactThreadSections({
          room: jobsRoom,
          now: NOW,
          threadRootIds: ['$a', '$b', '$c'],
          threadRecordMap,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()), initialProps: { threadRecordMap: running } }
    );
    expect(result.current).toEqual([
      { id: 'needsYou', rootIds: ['$a'] },
      { id: 'working', rootIds: ['$b'] },
      { id: 'done', rootIds: ['$c'] },
    ]);

    rerender({
      threadRecordMap: recordsOf(
        record('$a'),
        record('$b', { hasBackgroundJob: true, hasBackgroundApproval: true }),
        record('$c', { isResolved: true })
      ),
    });

    expect(result.current).toEqual([
      { id: 'needsYou', rootIds: ['$a', '$b'] },
      { id: 'done', rootIds: ['$c'] },
    ]);
    expect(getStateEvents).not.toHaveBeenCalled();
  });

  it('orders Done by the resolve time the index holds for the room', () => {
    const store = createStore();
    const entry = (rootId: string, resolvedTs: number) =>
      ({
        key: getCrossRoomThreadIndexKey(ROOM_ID, rootId),
        roomId: ROOM_ID,
        threadRootId: rootId,
        resolvedTs,
      } as CrossRoomThreadIndexEntry);
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map(
        [entry('$old', 1), entry('$new', 2)].map((item) => [item.key, item] as const)
      ),
    });
    const { room: doneRoom } = room();
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room: doneRoom,
          now: NOW,
          threadRootIds: ['$old', '$new'],
          threadRecordMap: recordsOf(
            record('$old', { isResolved: true }),
            record('$new', { isResolved: true })
          ),
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(store) }
    );

    expect(result.current).toEqual([{ id: 'done', rootIds: ['$new', '$old'] }]);
  });

  it('moves a thread to Quiet on timer at 5 days without shifting the snooze clock', () => {
    vi.useFakeTimers();
    const base = 10 * QUIET_AFTER_MS;
    vi.setSystemTime(base);
    const { room: timedRoom } = room();
    const records = recordsOf(
      record('$aging', { lastActivityTs: base - QUIET_AFTER_MS + 1_000 }),
      record('$snoozed', { snoozedUntilTs: base + 500 })
    );
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room: timedRoom,
          now: base,
          threadRootIds: ['$aging', '$snoozed'],
          threadRecordMap: records,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()) }
    );
    expect(result.current).toEqual([
      { id: 'needsYou', rootIds: ['$aging'] },
      { id: 'later', rootIds: ['$snoozed'] },
    ]);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toEqual([
      { id: 'later', rootIds: ['$snoozed'] },
      { id: 'quiet', rootIds: ['$aging'] },
    ]);
  });

  it('re-evaluates Quiet when room unread counts change', () => {
    vi.useFakeTimers();
    const store = createStore();
    const base = 10 * QUIET_AFTER_MS;
    vi.setSystemTime(base);
    const entry = {
      key: getCrossRoomThreadIndexKey(ROOM_ID, '$mentioned'),
      roomId: ROOM_ID,
      threadRootId: '$mentioned',
    } as CrossRoomThreadIndexEntry;
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([[entry.key, entry]]),
    });
    store.set(roomToUnreadAtom, {
      type: 'PUT',
      unreadInfo: { roomId: ROOM_ID, total: 1, highlight: 1 },
    });
    let mentioned = true;
    readSignals.mockImplementation(() => ({ mentionedMe: mentioned, newCount: 0 }));

    const { room: unreadRoom } = room();
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room: unreadRoom,
          now: base,
          threadRootIds: ['$mentioned'],
          threadRecordMap: recordsOf(
            record('$mentioned', { lastActivityTs: base - QUIET_AFTER_MS })
          ),
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(store) }
    );
    expect(result.current).toEqual([{ id: 'needsYou', rootIds: ['$mentioned'] }]);

    mentioned = false;
    act(() => store.set(roomToUnreadAtom, { type: 'DELETE', roomId: ROOM_ID }));
    expect(result.current).toEqual([{ id: 'quiet', rootIds: ['$mentioned'] }]);
  });

  it('folds already-due threads on the first render when Sections turns on after wall time passes, preserving snooze parity', () => {
    vi.useFakeTimers();
    const openedAt = 10 * QUIET_AFTER_MS;
    const minute = 60 * 1_000;
    const hour = 60 * minute;
    vi.setSystemTime(openedAt);
    const { room: delayedRoom } = room();
    const records = recordsOf(
      record('$due', { lastActivityTs: openedAt + hour - QUIET_AFTER_MS }),
      record('$snoozed', { snoozedUntilTs: openedAt + 30 * minute })
    );

    const { result, rerender } = renderHook(
      ({ now }: { now: number | undefined }) =>
        useCompactThreadSections({
          room: delayedRoom,
          now,
          threadRootIds: ['$due', '$snoozed'],
          threadRecordMap: records,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()), initialProps: { now: undefined as number | undefined } }
    );
    expect(result.current).toBeUndefined();

    // Wall time advances 70 minutes past room open; Sections turns on with the stale snooze clock.
    vi.setSystemTime(openedAt + 70 * minute);
    rerender({ now: openedAt });
    expect(result.current).toEqual([
      { id: 'later', rootIds: ['$snoozed'] },
      { id: 'quiet', rootIds: ['$due'] },
    ]);

    // Once the snooze clock catches up, the snoozed thread leaves Later for Needs you.
    rerender({ now: openedAt + 70 * minute });
    expect(result.current).toEqual([
      { id: 'needsYou', rootIds: ['$snoozed'] },
      { id: 'quiet', rootIds: ['$due'] },
    ]);
  });

  it('arms the Quiet timer against wall time when Sections turns on with a stale snooze clock', () => {
    vi.useFakeTimers();
    const openedAt = 10 * QUIET_AFTER_MS;
    const minute = 60 * 1_000;
    const hour = 60 * minute;
    vi.setSystemTime(openedAt);
    const { room: timedRoom } = room();
    const records = recordsOf(
      record('$due', { lastActivityTs: openedAt + hour - QUIET_AFTER_MS })
    );

    const { result, rerender } = renderHook(
      ({ now }: { now: number | undefined }) =>
        useCompactThreadSections({
          room: timedRoom,
          now,
          threadRootIds: ['$due'],
          threadRecordMap: records,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()), initialProps: { now: undefined as number | undefined } }
    );
    expect(result.current).toBeUndefined();

    // Enable Sections 30 minutes after room open with the stale 11:00 snooze clock; due at 12:00.
    vi.setSystemTime(openedAt + 30 * minute);
    rerender({ now: openedAt });
    expect(result.current).toEqual([{ id: 'needsYou', rootIds: ['$due'] }]);

    act(() => {
      vi.advanceTimersByTime(30 * minute - 1);
    });
    expect(result.current).toEqual([{ id: 'needsYou', rootIds: ['$due'] }]);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual([{ id: 'quiet', rootIds: ['$due'] }]);
  });

  it('folds a past-due thread arriving while Sections is open immediately without looping', () => {
    vi.useFakeTimers();
    const openedAt = 10 * QUIET_AFTER_MS;
    const minute = 60 * 1_000;
    const hour = 60 * minute;
    vi.setSystemTime(openedAt);
    const { room: openRoom } = room();

    const { result, rerender } = renderHook(
      ({
        threadRootIds,
        threadRecordMap,
      }: {
        threadRootIds: string[];
        threadRecordMap: ReadonlyMap<string, ThreadRecord>;
      }) =>
        useCompactThreadSections({
          room: openRoom,
          now: openedAt,
          threadRootIds,
          threadRecordMap,
          pinnedRootIds: [],
        }),
      {
        wrapper: wrapperOf(createStore()),
        initialProps: { threadRootIds: [] as string[], threadRecordMap: recordsOf() },
      }
    );
    expect(result.current).toEqual([]);

    vi.setSystemTime(openedAt + 70 * minute);
    rerender({
      threadRootIds: ['$due'],
      threadRecordMap: recordsOf(
        record('$due', { lastActivityTs: openedAt + hour - QUIET_AFTER_MS })
      ),
    });

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toEqual([{ id: 'quiet', rootIds: ['$due'] }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
