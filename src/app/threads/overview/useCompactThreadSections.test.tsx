// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, RoomStateEvent, type Room } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../../event-store/threads/types';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../../matrix/protocol/backgroundJobsContract';
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
const AGENT = '@mindroom_code:example.org';

const jobsState = (threadIds: string[]) =>
  new MatrixEvent({
    type: MINDROOM_BACKGROUND_JOBS_EVENT,
    sender: AGENT,
    state_key: AGENT,
    room_id: ROOM_ID,
    content: {
      jobs: threadIds.map((threadId, index) => ({
        job_id: `job_${index}`,
        thread_id: threadId,
        kind: 'subagent',
        tool: 'delegate',
        status: 'running',
        started_at: '2026-11-16T00:00:00+00:00',
      })),
    },
  });

/** A room whose agent publishes `jobs`; `publish` replaces them as a sync would. */
const roomWithJobs = (initial: MatrixEvent) => {
  let jobs = initial;
  const emitter = new EventEmitter();
  const getStateEvents = vi.fn((type: string) =>
    type === MINDROOM_BACKGROUND_JOBS_EVENT ? [jobs] : []
  );
  const room = Object.assign(emitter, {
    roomId: ROOM_ID,
    myUserId: '@me:example.org',
    client: {},
    currentState: { getStateEvents },
    getMember: (userId: string) => ({ userId, membership: 'join' }),
  }) as unknown as Room;
  const publish = (next: MatrixEvent) => {
    jobs = next;
    act(() => {
      emitter.emit(RoomStateEvent.Events, next);
    });
  };
  return { room, publish, getStateEvents };
};

const record = (rootId: string, isResolved = false): ThreadRecord =>
  ({
    roomId: ROOM_ID,
    threadRootId: rootId,
    status: { isStreaming: false, isResolved, tags: [] },
    cache: {},
  } as unknown as ThreadRecord);

const records = new Map(['$a', '$b', '$c'].map((id) => [id, record(id, id === '$c')] as const));
const ROOT_IDS = ['$a', '$b', '$c'];

const wrapperOf =
  (store: ReturnType<typeof createStore>) =>
  ({ children }: { children: ReactNode }) =>
    <Provider store={store}>{children}</Provider>;

describe('useCompactThreadSections', () => {
  it('reads nothing while Sections are off', () => {
    const { room, getStateEvents } = roomWithJobs(jobsState(['$a']));
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room,
          enabled: false,
          threadRootIds: ROOT_IDS,
          threadRecordMap: records,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()) }
    );

    expect(result.current).toBeUndefined();
    expect(getStateEvents).not.toHaveBeenCalled();
  });

  it('puts the thread of a live job in Working, and back when the job leaves the state', () => {
    const { room, publish } = roomWithJobs(jobsState(['$b']));
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room,
          enabled: true,
          threadRootIds: ROOT_IDS,
          threadRecordMap: records,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(createStore()) }
    );
    expect(result.current).toEqual([
      { id: 'working', rootIds: ['$b'] },
      { id: 'idle', rootIds: ['$a'] },
      { id: 'resolved', rootIds: ['$c'] },
    ]);

    publish(jobsState([]));

    expect(result.current).toEqual([
      { id: 'idle', rootIds: ['$a', '$b'] },
      { id: 'resolved', rootIds: ['$c'] },
    ]);
  });

  it('orders Resolved by the resolve time the index holds for the room', () => {
    const store = createStore();
    const resolvedRecords = new Map(['$old', '$new'].map((id) => [id, record(id, true)] as const));
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
    const { room } = roomWithJobs(jobsState([]));
    const { result } = renderHook(
      () =>
        useCompactThreadSections({
          room,
          enabled: true,
          threadRootIds: ['$old', '$new'],
          threadRecordMap: resolvedRecords,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(store) }
    );

    expect(result.current).toEqual([{ id: 'resolved', rootIds: ['$new', '$old'] }]);
  });
});
