// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { ThreadBoard } from './ThreadBoard';

const mocks = vi.hoisted(() => ({
  jobs: [] as BackgroundJob[],
  scheduleEvents: [] as MatrixEvent[],
  navigateRoomThread: vi.fn(),
  listComplete: true,
  loadRoomThreads: vi.fn(async () => undefined),
}));

// Each column's cards, as the Compact view would draw them: one item per thread, in order.
vi.mock('../overview/CompactRoomView', () => ({
  CompactRoomView: ({
    threadRootIds,
    onThreadClick,
  }: {
    threadRootIds: string[];
    onThreadClick: (rootId: string) => void;
  }) => (
    <ol>
      {threadRootIds.map((rootId) => (
        <li key={rootId}>
          <button type="button" onClick={() => onThreadClick(rootId)}>
            {rootId}
          </button>
        </li>
      ))}
    </ol>
  ),
}));
vi.mock('../../background-jobs/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({ jobs: mocks.jobs, total: mocks.jobs.length }),
}));
vi.mock('../../schedules/useScheduledTaskEvents', () => ({
  useScheduledTaskEvents: () => mocks.scheduleEvents,
}));
vi.mock('../../event-store/threads/roomThreadList', () => ({
  loadRoomThreads: mocks.loadRoomThreads,
  roomThreadListIsComplete: () => mocks.listComplete,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: mocks.navigateRoomThread }),
}));

const ROOM_ID = '!room:example.org';
const room = { roomId: ROOM_ID } as Room;
const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const MINUTE = 60_000;

const makeRecord = (threadRootId: string, status: Partial<ThreadStatusSnapshot> = {}) =>
  ({
    roomId: ROOM_ID,
    threadRootId,
    presentation: {},
    status: {
      isKnownThreadRoot: true,
      replyCount: 1,
      isResolved: false,
      isUnread: false,
      isStreaming: false,
      scheduledTaskCount: 0,
      tags: [],
      ...status,
    },
    cache: {},
    absoluteIndex: 0,
  } as ThreadRecord);

type Threads = [string, Partial<ThreadStatusSnapshot>][];

/** The index as the app-wide thread index holds these threads of the room, and one of another. */
const indexOf = (threads: Threads, scanned = true) => {
  const entries = new Map<string, CrossRoomThreadIndexEntry>();
  [...threads, ['$elsewhere', {}] as [string, Partial<ThreadStatusSnapshot>]].forEach(
    ([id, status]) => {
      const roomId = id === '$elsewhere' ? '!other:example.org' : ROOM_ID;
      entries.set(`${roomId}|${id}`, {
        roomId,
        threadRootId: id,
        threadRecord: { ...makeRecord(id, status), roomId },
      } as CrossRoomThreadIndexEntry);
    }
  );
  return { ...emptyCrossRoomThreadIndexSnapshot(), entries, bootstrapped: scanned };
};

const renderBoard = (threads: Threads, scanned = true) => {
  const store = createStore();
  store.set(crossRoomThreadIndexAtom, indexOf(threads, scanned));
  const result = render(
    <Provider store={store}>
      <ThreadBoard room={room} />
    </Provider>
  );
  return {
    ...result,
    update: (next: Threads, nextScanned = true) =>
      act(() => {
        store.set(crossRoomThreadIndexAtom, indexOf(next, nextScanned));
      }),
    store,
  };
};

const column = (name: string) => {
  const heading = screen.getByRole('heading', { name: new RegExp(`^${name} `) });
  const section = heading.closest('section');
  if (!section) throw new Error(`no column ${name}`);
  return section;
};
const cardsOf = (name: string) =>
  within(column(name))
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

describe('ThreadBoard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    mocks.jobs = [];
    mocks.scheduleEvents = [];
    mocks.navigateRoomThread.mockReset();
    mocks.listComplete = true;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows four columns with their names and full counts, and a thread in one only', () => {
    renderBoard([
      ['$stream', { isStreaming: true, isResolved: true }],
      ['$snoozed', { snoozedUntilTs: NOW + 5 * MINUTE }],
      ['$open', {}],
      ['$done-1', { isResolved: true }],
      ['$done-2', { isResolved: true }],
    ]);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    ).toEqual(['Working 1', 'Later 1', 'Open 1', 'Done 2']);
    expect(cardsOf('Working')).toEqual(['$stream']);
    expect(cardsOf('Later')).toEqual(['$snoozed']);
    expect(cardsOf('Open')).toEqual(['$open']);
    expect(cardsOf('Done')).toEqual(['$done-1', '$done-2']);
  });

  it('leaves out a thread without a reply, as the Threads page does, until one of its own is sending', () => {
    renderBoard([
      ['$replied', {}],
      ['$no-reply', { replyCount: 0 }],
      ['$sending', { replyCount: 0, hasPendingSend: true }],
    ]);
    expect(cardsOf('Open')).toEqual(['$replied', '$sending']);
    expect(screen.getByRole('heading', { name: 'Open 2' })).toBeTruthy();
  });

  it('keeps an empty column with 0', () => {
    renderBoard([['$open', {}]]);
    expect(screen.getByRole('heading', { name: 'Working 0' })).toBeTruthy();
    // No list under it, so no Compact "No threads" while the board may still be loading.
    expect(within(column('Working')).queryByRole('list')).toBeNull();
  });

  it('shows the first 20 of Open and Done, and 20 more for each Show more', () => {
    const open = Array.from({ length: 45 }, (_, index): [string, Partial<ThreadStatusSnapshot>] => [
      `$open-${index}`,
      { lastActivityTs: 1000 - index },
    ]);
    const done = Array.from({ length: 21 }, (_, index): [string, Partial<ThreadStatusSnapshot>] => [
      `$done-${index}`,
      { isResolved: true, lastActivityTs: 1000 - index },
    ]);
    renderBoard([...open, ...done]);
    expect(screen.getByRole('heading', { name: 'Open 45' })).toBeTruthy();
    expect(cardsOf('Open')).toHaveLength(20);
    expect(cardsOf('Open')[19]).toBe('$open-19');
    expect(cardsOf('Done')).toHaveLength(20);

    fireEvent.click(within(column('Open')).getByRole('button', { name: 'Show more' }));
    expect(cardsOf('Open')).toHaveLength(40);
    expect(cardsOf('Done')).toHaveLength(20);
    fireEvent.click(within(column('Open')).getByRole('button', { name: 'Show more' }));
    expect(cardsOf('Open')).toHaveLength(45);
    expect(within(column('Open')).queryByRole('button', { name: 'Show more' })).toBeNull();

    fireEvent.click(within(column('Done')).getByRole('button', { name: 'Show more' }));
    expect(cardsOf('Done')).toHaveLength(21);
  });

  it('shows every thread of Working and Later', () => {
    renderBoard(
      Array.from({ length: 50 }, (_, index): [string, Partial<ThreadStatusSnapshot>] => [
        `$t-${index}`,
        index % 2 ? { isStreaming: true } : { snoozedUntilTs: NOW + (index + 1) * MINUTE },
      ])
    );
    expect(cardsOf('Working')).toHaveLength(25);
    expect(cardsOf('Later')).toHaveLength(25);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('puts unread threads first in Open, and the soonest first in Later', () => {
    renderBoard([
      ['$read', { lastActivityTs: 3 }],
      ['$unread', { isUnread: true, lastActivityTs: 1 }],
      ['$late', { snoozedUntilTs: NOW + 9 * MINUTE }],
      ['$soon', { snoozedUntilTs: NOW + MINUTE }],
    ]);
    expect(cardsOf('Open')).toEqual(['$unread', '$read']);
    expect(cardsOf('Later')).toEqual(['$soon', '$late']);
  });

  it('moves a thread out of Later when its snooze ends, with nothing else happening', () => {
    renderBoard([['$snoozed', { snoozedUntilTs: NOW + 5 * MINUTE }]]);
    expect(cardsOf('Later')).toEqual(['$snoozed']);
    act(() => {
      vi.advanceTimersByTime(5 * MINUTE + 1);
    });
    expect(cardsOf('Later')).toEqual([]);
    expect(cardsOf('Open')).toEqual(['$snoozed']);
  });

  it('moves a thread as the index changes, and as a job starts', () => {
    const { update } = renderBoard([['$t', {}]]);
    expect(cardsOf('Open')).toEqual(['$t']);
    update([['$t', { isResolved: true }]]);
    expect(cardsOf('Done')).toEqual(['$t']);
    update([['$t', {}]]);
    expect(cardsOf('Open')).toEqual(['$t']);
    mocks.jobs = [
      {
        jobId: 'job',
        agentId: '@agent:example.org',
        threadId: '$t',
        kind: 'tool',
        tool: 'shell',
        status: 'running',
        startedAt: '2026-11-16T11:59:00Z',
      },
    ];
    update([['$t', {}]]);
    expect(cardsOf('Working')).toEqual(['$t']);
  });

  it('opens the thread in the room page when a card is chosen', () => {
    renderBoard([['$open', {}]]);
    fireEvent.click(screen.getByRole('button', { name: '$open' }));
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$open');
  });

  it('shows one line for a room without a thread, instead of four empty columns', () => {
    renderBoard([]);
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText('No threads')).toBeTruthy();
  });

  it('says it is loading, not that there is no thread, until the index has scanned the rooms', () => {
    const { update } = renderBoard([], false);
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText('Loading threads')).toBeTruthy();
    update([['$open', {}]]);
    expect(cardsOf('Open')).toEqual(['$open']);
    expect(screen.queryByText('Loading threads')).toBeNull();
  });

  it("loads the room's thread list, and says so above the threads it knows until it is in", () => {
    mocks.listComplete = false;
    renderBoard([['$open', {}]]);
    expect(mocks.loadRoomThreads).toHaveBeenCalledWith(
      room,
      expect.any(Function),
      expect.anything()
    );
    expect(screen.getByText('Loading threads')).toBeTruthy();
    expect(cardsOf('Open')).toEqual(['$open']);
  });

  it('says it is loading, not that there is no thread, while the thread list is out', () => {
    mocks.listComplete = false;
    renderBoard([]);
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText('Loading threads')).toBeTruthy();
  });
});
