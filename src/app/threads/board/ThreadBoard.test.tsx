// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'jotai';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import { useShareCompactThreads, type CompactThreads } from './compactThreads';
import { ThreadBoard } from './ThreadBoard';

const mocks = vi.hoisted(() => ({
  jobs: [] as BackgroundJob[],
  scheduleEvents: [] as MatrixEvent[],
  navigateRoomThread: vi.fn(),
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

const threadsOf = (
  entries: [string, Partial<ThreadStatusSnapshot>][],
  loading = false
): CompactThreads => ({
  rootIds: entries.map(([id]) => id),
  records: new Map(entries.map(([id, status]) => [id, makeRecord(id, status)])),
  loading,
});

/** The room page's share, as RoomTimeline makes it, beside the board. */
function Page({ threads, children }: { threads: CompactThreads | undefined; children: ReactNode }) {
  useShareCompactThreads(ROOM_ID, threads);
  return <>{children}</>;
}

const renderBoard = (threads: CompactThreads | undefined) => {
  const view = (next: CompactThreads | undefined) => (
    <Provider>
      <Page threads={next}>
        <ThreadBoard room={room} />
      </Page>
    </Provider>
  );
  const result = render(view(threads));
  return { ...result, update: (next: CompactThreads | undefined) => result.rerender(view(next)) };
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
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows four columns with their names and full counts, and a thread in one only', () => {
    renderBoard(
      threadsOf([
        ['$stream', { isStreaming: true, isResolved: true }],
        ['$snoozed', { snoozedUntilTs: NOW + 5 * MINUTE }],
        ['$open', {}],
        ['$done-1', { isResolved: true }],
        ['$done-2', { isResolved: true }],
      ])
    );
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    ).toEqual(['Working 1', 'Later 1', 'Open 1', 'Done 2']);
    expect(cardsOf('Working')).toEqual(['$stream']);
    expect(cardsOf('Later')).toEqual(['$snoozed']);
    expect(cardsOf('Open')).toEqual(['$open']);
    expect(cardsOf('Done')).toEqual(['$done-1', '$done-2']);
  });

  it('keeps an empty column with 0', () => {
    renderBoard(threadsOf([['$open', {}]]));
    expect(screen.getByRole('heading', { name: 'Working 0' })).toBeTruthy();
    expect(cardsOf('Working')).toEqual([]);
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
    renderBoard(threadsOf([...open, ...done]));
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
      threadsOf(
        Array.from({ length: 50 }, (_, index): [string, Partial<ThreadStatusSnapshot>] => [
          `$t-${index}`,
          index % 2 ? { isStreaming: true } : { snoozedUntilTs: NOW + (index + 1) * MINUTE },
        ])
      )
    );
    expect(cardsOf('Working')).toHaveLength(25);
    expect(cardsOf('Later')).toHaveLength(25);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('puts unread threads first in Open, and the soonest first in Later', () => {
    renderBoard(
      threadsOf([
        ['$read', { lastActivityTs: 3 }],
        ['$unread', { isUnread: true, lastActivityTs: 1 }],
        ['$late', { snoozedUntilTs: NOW + 9 * MINUTE }],
        ['$soon', { snoozedUntilTs: NOW + MINUTE }],
      ])
    );
    expect(cardsOf('Open')).toEqual(['$unread', '$read']);
    expect(cardsOf('Later')).toEqual(['$soon', '$late']);
  });

  it('moves a thread out of Later when its snooze ends, with nothing else happening', () => {
    renderBoard(threadsOf([['$snoozed', { snoozedUntilTs: NOW + 5 * MINUTE }]]));
    expect(cardsOf('Later')).toEqual(['$snoozed']);
    act(() => {
      vi.advanceTimersByTime(5 * MINUTE + 1);
    });
    expect(cardsOf('Later')).toEqual([]);
    expect(cardsOf('Open')).toEqual(['$snoozed']);
  });

  it('moves a thread as the room page shares new records, and as a job starts', () => {
    const { update } = renderBoard(threadsOf([['$t', {}]]));
    expect(cardsOf('Open')).toEqual(['$t']);
    update(threadsOf([['$t', { isResolved: true }]]));
    expect(cardsOf('Done')).toEqual(['$t']);
    update(threadsOf([['$t', {}]]));
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
    update(threadsOf([['$t', {}]]));
    expect(cardsOf('Working')).toEqual(['$t']);
  });

  it('opens the thread in the room page when a card is chosen', () => {
    renderBoard(threadsOf([['$open', {}]]));
    fireEvent.click(screen.getByRole('button', { name: '$open' }));
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$open');
  });

  it('shows one line for a room without a thread, instead of four empty columns', () => {
    renderBoard(threadsOf([]));
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText('No threads')).toBeTruthy();
  });

  it('says it is loading while the room page does not know yet whether there is a thread', () => {
    renderBoard(threadsOf([], true));
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText('Loading threads')).toBeTruthy();
  });

  it('shows no thread as Open while the room page shows no Compact view', () => {
    renderBoard(undefined);
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText(/Compact/)).toBeTruthy();
  });

  it('lets go of the threads as the room page leaves Compact', () => {
    const { update } = renderBoard(threadsOf([['$open', {}]]));
    expect(cardsOf('Open')).toEqual(['$open']);
    update(undefined);
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getByText(/Compact/)).toBeTruthy();
  });
});
