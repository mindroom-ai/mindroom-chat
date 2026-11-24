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
    const store = createStore();
    const base = 10 * QUIET_AFTER_MS;
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
});
