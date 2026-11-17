// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { useCompactThreadSections } from './useCompactThreadSections';

vi.mock('../cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: () => ({}) }),
}));

const ROOM_ID = '!room:example.org';

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
  it('reads nothing while Sections are off', () => {
    const { room: offRoom } = room();
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room: offRoom,
          enabled: false,
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
          enabled: true,
          threadRootIds: ['$a', '$b', '$c'],
          threadRecordMap,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()), initialProps: { threadRecordMap: running } }
    );
    expect(result.current).toEqual([
      { id: 'working', rootIds: ['$b'] },
      { id: 'needsYou', rootIds: ['$a'] },
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
          enabled: true,
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
});
