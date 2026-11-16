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

const signalsRead = vi.hoisted(() =>
  vi.fn((_room: Room, _entry: CrossRoomThreadIndexEntry) => ({}))
);
vi.mock('../cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: signalsRead }),
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
  // Each thread's loaded events, as the SDK's thread holds them.
  const threads = new Map<string, { events: MatrixEvent[] }>();
  const room = Object.assign(emitter, {
    roomId: ROOM_ID,
    myUserId: '@me:example.org',
    client: {},
    currentState: { getStateEvents },
    getMember: (userId: string) => ({ userId, membership: 'join' }),
    getThread: (rootId: string) => threads.get(rootId) ?? null,
  }) as unknown as Room;
  const publish = (next: MatrixEvent) => {
    jobs = next;
    act(() => {
      emitter.emit(RoomStateEvent.Events, next);
    });
  };
  return { room, publish, getStateEvents, threads };
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

  it("reads an Idle thread's signals again only once its own entry changes", () => {
    signalsRead.mockClear();
    const store = createStore();
    const entry = (rootId: string, generation = 0) =>
      ({
        key: getCrossRoomThreadIndexKey(ROOM_ID, rootId),
        roomId: ROOM_ID,
        threadRootId: rootId,
        generation,
      } as CrossRoomThreadIndexEntry);
    const index = (...entries: CrossRoomThreadIndexEntry[]) =>
      act(() => {
        store.set(crossRoomThreadIndexAtom, {
          ...emptyCrossRoomThreadIndexSnapshot(),
          entries: new Map(entries.map((item) => [item.key, item] as const)),
        });
      });
    const readsOf = (read: CrossRoomThreadIndexEntry) =>
      signalsRead.mock.calls.filter(([, item]) => item === read).length;
    // As the room builds them: new records for every thread on each update.
    const recordsWith = (streaming: boolean) =>
      new Map([
        ['$a', { ...record('$a'), status: { ...record('$a').status, isStreaming: streaming } }],
        ['$b', record('$b')],
      ] as const);
    const idleB = entry('$b');
    index(entry('$a'), idleB);
    const { room } = roomWithJobs(jobsState([]));
    const { rerender } = renderHook(
      ({ recordMap }: { recordMap: ReadonlyMap<string, ThreadRecord> }) =>
        useCompactThreadSections({
          room,
          enabled: true,
          threadRootIds: ['$a', '$b'],
          threadRecordMap: recordMap,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(store), initialProps: { recordMap: recordsWith(false) } }
    );
    const mountReads = readsOf(idleB);
    expect(mountReads).toBeGreaterThan(0);

    // A stream chunk in $a: its entry and every record are new, $b's entry is not.
    index(entry('$a', 1), idleB);
    rerender({ recordMap: recordsWith(true) });
    expect(readsOf(idleB)).toBe(mountReads);

    const repliedB = entry('$b', 1);
    index(entry('$a', 1), repliedB);
    rerender({ recordMap: recordsWith(true) });
    expect(readsOf(repliedB)).toBe(1);
  });

  it("reads an Idle thread's signals again when its own events change, its entry the same", () => {
    signalsRead.mockClear();
    const store = createStore();
    const entryB = {
      key: getCrossRoomThreadIndexKey(ROOM_ID, '$b'),
      roomId: ROOM_ID,
      threadRootId: '$b',
      generation: 0,
    } as CrossRoomThreadIndexEntry;
    act(() => {
      store.set(crossRoomThreadIndexAtom, {
        ...emptyCrossRoomThreadIndexSnapshot(),
        entries: new Map([[entryB.key, entryB]]),
      });
    });
    const { room, threads } = roomWithJobs(jobsState([]));
    const reply = (id: string) => new MatrixEvent({ event_id: id, type: 'm.room.message' });
    threads.set('$b', { events: [reply('$r1'), reply('$r2')] });
    const { rerender } = renderHook(
      ({ recordMap }: { recordMap: ReadonlyMap<string, ThreadRecord> }) =>
        useCompactThreadSections({
          room,
          enabled: true,
          threadRootIds: ['$b'],
          threadRecordMap: recordMap,
          pinnedRootIds: [],
        }),
      { wrapper: wrapperOf(store), initialProps: { recordMap: new Map([['$b', record('$b')]]) } }
    );
    const mountReads = signalsRead.mock.calls.length;

    // An edit of an older reply arrives: the thread holds it, the index entry stays equivalent.
    threads.set('$b', { events: [reply('$r1'), reply('$r2'), reply('$edit-of-r1')] });
    rerender({ recordMap: new Map([['$b', record('$b')]]) });

    expect(signalsRead.mock.calls.length).toBe(mountReads + 1);
  });
});
