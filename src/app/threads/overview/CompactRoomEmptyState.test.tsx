// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultThreadFilterState,
  selectThreadWorkflowTab,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import type { ThreadRecord } from '../../event-store/threads/types';
import {
  CompactRoomEmptyState,
  classifyCompactRoomEmptyState,
  type CompactRoomEmptyStateProps,
} from './CompactRoomEmptyState';
import * as css from './CompactRoomEmptyState.css';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

const makeRecord = (
  threadRootId: string,
  options: {
    summaryText?: string;
    isResolved?: boolean;
    snoozedUntilTs?: number;
    lastActivityTs?: number;
    oldestTs?: number;
  } = {}
): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: options.summaryText,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 1,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: options.summaryText,
    recentThreadSummaryText: options.summaryText,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 1,
    isResolved: options.isResolved ?? false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: options.lastActivityTs,
    tags: [],
    snoozedUntilTs: options.snoozedUntilTs,
  },
  cache: {
    eventCount: 2,
    oldestTs: options.oldestTs,
    relationSnapshotComplete: true,
    tailLoaded: true,
  },
  absoluteIndex: 0,
});

const makeRoom = (): Room =>
  ({
    roomId: '!room:example.org',
    getMember: () => null,
  }) as unknown as Room;

const unresolvedFilter = (overrides: Partial<ThreadFilterState> = {}): ThreadFilterState => ({
  ...createDefaultThreadFilterState(),
  resolved: 'exclude',
  snoozed: 'exclude',
  ...overrides,
});

const setReducedMotion = (reduced: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
};

const renderEmptyState = (overrides: Partial<CompactRoomEmptyStateProps> = {}) => {
  const props: CompactRoomEmptyStateProps = {
    room: makeRoom(),
    threadRecordMap: new Map([
      [
        '$resolved-1',
        makeRecord('$resolved-1', {
          summaryText: 'Deploy checklist',
          isResolved: true,
          lastActivityTs: NOW - 5 * 60_000,
        }),
      ],
    ]),
    filterState: unresolvedFilter(),
    now: NOW,
    canCompose: true,
    indexPending: false,
    canToggle: true,
    updatingThreadRootIds: new Set(),
    onThreadClick: vi.fn(),
    onSetResolved: vi.fn(),
    onReset: vi.fn(),
    onToggleForMe: vi.fn(),
    onShowSnoozed: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CompactRoomEmptyState {...props} />) };
};

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});

describe('classifyCompactRoomEmptyState', () => {
  it('classifies Inbox Zero in Simple mode and Advanced open tabs when no open threads remain', () => {
    const records = new Map<string, ThreadRecord>([
      [
        '$resolved-old',
        makeRecord('$resolved-old', {
          isResolved: true,
          lastActivityTs: NOW - 30_000,
          oldestTs: NOW - 60_000,
        }),
      ],
      [
        '$resolved-tie-b',
        makeRecord('$resolved-tie-b', {
          isResolved: true,
          lastActivityTs: NOW - 10_000,
          oldestTs: NOW - 50_000,
        }),
      ],
      [
        '$resolved-tie-a',
        makeRecord('$resolved-tie-a', {
          isResolved: true,
          lastActivityTs: NOW - 10_000,
          oldestTs: NOW - 50_000,
        }),
      ],
      [
        '$resolved-and-snoozed',
        makeRecord('$resolved-and-snoozed', {
          isResolved: true,
          snoozedUntilTs: NOW + 60_000,
          lastActivityTs: NOW - 20_000,
        }),
      ],
      ['$snoozed', makeRecord('$snoozed', { snoozedUntilTs: NOW + 60_000 })],
    ]);

    const simpleModel = classifyCompactRoomEmptyState(records, unresolvedFilter(), NOW);
    expect(simpleModel.kind).toBe('inboxZero');
    expect(simpleModel.resolvedCount).toBe(4);
    expect(simpleModel.snoozedCount).toBe(1);
    expect(simpleModel.openCount).toBe(0);
    expect(simpleModel.recentlyResolved.map((r) => r.threadRootId)).toEqual([
      '$resolved-tie-a',
      '$resolved-tie-b',
    ]);

    const needsYouModel = classifyCompactRoomEmptyState(
      records,
      selectThreadWorkflowTab(createDefaultThreadFilterState(), 'needsYou'),
      NOW
    );
    expect(needsYouModel.kind).toBe('inboxZero');

    const workingModel = classifyCompactRoomEmptyState(
      records,
      selectThreadWorkflowTab(createDefaultThreadFilterState(), 'working'),
      NOW
    );
    expect(workingModel.kind).toBe('inboxZero');
  });

  it('never classifies as Inbox Zero when open threads exist or an extra filter/tab hides threads', () => {
    const allResolved = new Map<string, ThreadRecord>([
      ['$r1', makeRecord('$r1', { isResolved: true, lastActivityTs: NOW - 5_000 })],
    ]);
    const withExpiredSnooze = new Map<string, ThreadRecord>([
      ['$r1', makeRecord('$r1', { isResolved: true })],
      ['$expired', makeRecord('$expired', { snoozedUntilTs: NOW - 1 })],
    ]);

    expect(classifyCompactRoomEmptyState(withExpiredSnooze, unresolvedFilter(), NOW)).toMatchObject(
      { kind: 'filtered', openCount: 1, resolvedCount: 1, snoozedCount: 0 }
    );

    const nonInboxZeroFilters: ThreadFilterState[] = [
      unresolvedFilter({ forMe: true }),
      unresolvedFilter({ freeText: 'release' }),
      unresolvedFilter({ unsupportedQuery: 'from:bot' }),
      unresolvedFilter({ tags: new Map([['ops', 'include']]) }),
      unresolvedFilter({ people: ['@alice:example.org'] }),
      unresolvedFilter({ streaming: 'include' }),
      unresolvedFilter({ scheduled: 'include' }),
      unresolvedFilter({ unread: 'include' }),
      unresolvedFilter({ idle: 'exclude' }),
      unresolvedFilter({ snoozed: 'include' }),
      selectThreadWorkflowTab(createDefaultThreadFilterState(), 'done'),
      selectThreadWorkflowTab(createDefaultThreadFilterState(), 'later'),
    ];
    for (const filter of nonInboxZeroFilters) {
      expect(classifyCompactRoomEmptyState(allResolved, filter, NOW).kind).toBe('filtered');
    }
  });
});

describe('CompactRoomEmptyState', () => {
  it('renders Inbox Zero with counts, Show all, recently resolved peek, Reopen, and compose whisper', () => {
    const records = new Map<string, ThreadRecord>([
      [
        '$r1',
        makeRecord('$r1', {
          summaryText: 'Deploy checklist',
          isResolved: true,
          lastActivityTs: NOW - 120_000,
        }),
      ],
      [
        '$r2',
        makeRecord('$r2', {
          summaryText: 'Weekly triage',
          isResolved: true,
          lastActivityTs: NOW - 60_000,
        }),
      ],
      [
        '$r3',
        makeRecord('$r3', {
          summaryText: 'Older archive',
          isResolved: true,
          lastActivityTs: NOW - 300_000,
        }),
      ],
      ['$s1', makeRecord('$s1', { snoozedUntilTs: NOW + 60_000 })],
    ]);

    const { props } = renderEmptyState({ threadRecordMap: records });

    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeTruthy();
    expect(screen.getByText('3 resolved · 1 snoozed')).toBeTruthy();
    expect(screen.getByText('Start a new thread below')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '1 snoozed' }));
    expect(props.onShowSnoozed).toHaveBeenCalledTimes(1);

    expect(screen.getByText('Weekly triage')).toBeTruthy();
    expect(screen.getByText('Deploy checklist')).toBeTruthy();
    expect(screen.queryByText('Older archive')).toBeNull();

    const rowButton = screen.getByRole('button', { name: /^Weekly triage/ });
    const reopenButton = screen.getByRole('button', { name: 'Reopen: Weekly triage' });
    expect(rowButton.contains(reopenButton)).toBe(false);

    fireEvent.click(rowButton);
    expect(props.onThreadClick).toHaveBeenCalledWith('$r2', 'Weekly triage');

    fireEvent.click(reopenButton);
    expect(props.onSetResolved).toHaveBeenCalledWith('$r2', false);
  });

  it('omits zero counts, recently resolved peek when none exist, compose whisper, and Reopen when not allowed', () => {
    const snoozedOnly = new Map<string, ThreadRecord>([
      ['$s1', makeRecord('$s1', { snoozedUntilTs: NOW + 60_000 })],
      ['$s2', makeRecord('$s2', { snoozedUntilTs: NOW + 120_000 })],
    ]);
    renderEmptyState({ threadRecordMap: snoozedOnly, canCompose: false, canToggle: false });

    expect(screen.getByText('2 snoozed')).toBeTruthy();
    expect(screen.queryByText(/resolved/i)).toBeNull();
    expect(screen.queryByText('Start a new thread below')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recently resolved' })).toBeNull();

    cleanup();

    const unconfirmedAndUpdating = new Map<string, ThreadRecord>([
      [
        '~local-echo',
        makeRecord('~local-echo', {
          summaryText: 'Local draft',
          isResolved: true,
          lastActivityTs: NOW - 10_000,
        }),
      ],
      [
        '$updating',
        makeRecord('$updating', {
          summaryText: 'In flight',
          isResolved: true,
          lastActivityTs: NOW - 20_000,
        }),
      ],
    ]);
    renderEmptyState({
      threadRecordMap: unconfirmedAndUpdating,
      updatingThreadRootIds: new Set(['$updating']),
    });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reopen: Local draft' }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reopen: In flight' }).disabled
    ).toBe(true);
  });

  it('gates the Inbox Zero ring bloom animation on indexPending and reduced motion', () => {
    setReducedMotion(false);
    const { container, rerender } = renderEmptyState({ indexPending: false });
    const ring = () => container.querySelector('[data-empty-state-ring="success"]');
    expect(ring()?.className).toContain(css.IconRingSuccessAnimated);

    rerender(
      <CompactRoomEmptyState
        room={makeRoom()}
        threadRecordMap={
          new Map([['$r1', makeRecord('$r1', { isResolved: true, lastActivityTs: NOW - 1_000 })]])
        }
        filterState={unresolvedFilter()}
        now={NOW}
        canCompose={true}
        indexPending={true}
        canToggle={true}
        updatingThreadRootIds={new Set()}
        onThreadClick={vi.fn()}
        onSetResolved={vi.fn()}
        onReset={vi.fn()}
        onShowSnoozed={vi.fn()}
      />
    );
    expect(ring()?.className).not.toContain(css.IconRingSuccessAnimated);

    cleanup();
    setReducedMotion(true);
    const reduced = renderEmptyState({ indexPending: false });
    expect(
      reduced.container.querySelector('[data-empty-state-ring="success"]')?.className
    ).not.toContain(css.IconRingSuccessAnimated);
  });

  it('renders Filtered empty state for For me, open hidden threads, and empty workflow tabs', () => {
    const withOpen = new Map<string, ThreadRecord>([
      ['$open-1', makeRecord('$open-1', { summaryText: 'Open item' })],
      ['$open-2', makeRecord('$open-2', { summaryText: 'Second item' })],
    ]);
    const { props } = renderEmptyState({
      threadRecordMap: withOpen,
      filterState: unresolvedFilter({ forMe: true }),
    });

    expect(screen.getByRole('heading', { name: 'No threads match your filters' })).toBeTruthy();
    expect(screen.getByText('2 open threads are hidden by For me.')).toBeTruthy();
    expect(screen.queryByText('Start a new thread below')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Turn off For me' }));
    expect(props.onToggleForMe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);

    cleanup();

    const singleOpen = new Map<string, ThreadRecord>([['$open-1', makeRecord('$open-1')]]);
    const generic = renderEmptyState({
      threadRecordMap: singleOpen,
      filterState: unresolvedFilter({ freeText: 'missing' }),
    });
    expect(screen.getByText('1 open thread is hidden by your filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(generic.props.onReset).toHaveBeenCalledTimes(1);

    cleanup();

    renderEmptyState({
      threadRecordMap: new Map([['$s1', makeRecord('$s1', { snoozedUntilTs: NOW + 60_000 })]]),
      filterState: selectThreadWorkflowTab(createDefaultThreadFilterState(), 'done'),
    });
    expect(
      screen.getByText('Adjust or reset your filters to see threads in this room.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeTruthy();
  });
});
