// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultThreadFilterState,
  selectThreadWorkflowTab,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
  buildPerTagStateKey,
} from '../../event-store/threads/threadTags';
import type { ThreadRecord } from '../../event-store/threads/types';
import {
  CompactRoomEmptyState,
  classifyCompactRoomEmptyState,
  type CompactRoomEmptyStateProps,
} from './CompactRoomEmptyState';
import * as css from './CompactRoomEmptyState.css';
import { COMPACT_THREAD_TITLE_LIMIT } from './compactThreadCardUtils';

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

const makeResolvedTagEvent = (threadRootId: string, resolvedTs: number): MatrixEvent =>
  new MatrixEvent({
    content: { set_by: '@alice:example.org', set_at: new Date(resolvedTs).toISOString() },
    event_id: `$tag-${threadRootId}-${resolvedTs}`,
    origin_server_ts: resolvedTs,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: buildPerTagStateKey(threadRootId, RESOLVED_TAG),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makeRoom = (roomId = '!room:example.org', tagEvents: MatrixEvent[] = []): Room => {
  const roomState = {
    getStateEvents: (eventType: string) =>
      eventType === MINDROOM_THREAD_TAGS_EVENT ? [...tagEvents] : [],
  };
  return {
    roomId,
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => roomState }),
  } as unknown as Room;
};

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
    onRestoreFocus: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CompactRoomEmptyState {...props} />) };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    const longTitle = `${'Release readiness checklist '.repeat(8)}end`;
    const expectedTruncated = `${longTitle.slice(0, COMPACT_THREAD_TITLE_LIMIT - 3).trimEnd()}...`;
    const records = new Map<string, ThreadRecord>([
      [
        '$r1',
        makeRecord('$r1', {
          summaryText: longTitle,
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

    const peekRegion = screen.getByRole('region', { name: 'Recently resolved' });
    expect(peekRegion.getAttribute('aria-labelledby')).toBeTruthy();
    expect(peekRegion.getAttribute('aria-label')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '1 snoozed' }));
    expect(props.onShowSnoozed).toHaveBeenCalledTimes(1);

    const truncatedNode = screen.getByText(expectedTruncated);
    expect(truncatedNode.getAttribute('dir')).toBe('auto');
    expect(truncatedNode.hasAttribute('data-own-direction')).toBe(true);
    expect(screen.queryByText('Older archive')).toBeNull();

    const rowButton = screen.getByRole('button', { name: /^Weekly triage/ });
    const reopenButton = screen.getByRole('button', { name: 'Reopen thread: Weekly triage' });
    expect(rowButton.contains(reopenButton)).toBe(false);
    expect(reopenButton.textContent).toBe('Reopen thread');
    expect(
      screen.getByRole('button', { name: `Reopen thread: ${expectedTruncated}` })
    ).toBeTruthy();

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
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reopen thread: Local draft' }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reopen thread: In flight' }).disabled
    ).toBe(true);
  });

  it('gates only initial Inbox Zero on indexPending, offers Show all while loading, and keeps All caught up mounted on background refresh', () => {
    setReducedMotion(false);
    const partialResolved = new Map<string, ThreadRecord>([
      ['$r1', makeRecord('$r1', { isResolved: true, lastActivityTs: NOW - 1_000 })],
    ]);

    // Initial pending Inbox Zero: shows Loading threads + Show all without celebrating All caught up.
    const initial = renderEmptyState({ threadRecordMap: partialResolved, indexPending: true });
    expect(screen.getByRole('status').textContent).toContain('Loading threads');
    expect(screen.queryByRole('heading', { name: 'All caught up' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(initial.props.onReset).toHaveBeenCalledTimes(1);

    // An open thread arrives as loading finishes: never celebrated Inbox Zero.
    const withOpenArrived = new Map<string, ThreadRecord>([
      ...partialResolved,
      ['$open-1', makeRecord('$open-1', { summaryText: 'Arrived open thread' })],
    ]);
    initial.rerender(
      <CompactRoomEmptyState
        {...initial.props}
        threadRecordMap={withOpenArrived}
        indexPending={false}
      />
    );
    expect(screen.queryByRole('heading', { name: 'All caught up' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'No threads match your filters' })).toBeTruthy();

    // Fresh room settling with 0 open threads mounts Inbox Zero with bloom animation, then
    // flipping indexPending back to true on background refresh keeps All caught up mounted.
    cleanup();
    const settled = renderEmptyState({ threadRecordMap: partialResolved, indexPending: true });
    expect(screen.getByRole('status').textContent).toContain('Loading threads');
    settled.rerender(<CompactRoomEmptyState {...settled.props} indexPending={false} />);
    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeTruthy();
    const ringBefore = settled.container.querySelector('[data-empty-state-ring="success"]');
    expect(ringBefore?.className).toContain(css.IconRingSuccessAnimated);

    settled.rerender(<CompactRoomEmptyState {...settled.props} indexPending={true} />);
    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(settled.container.querySelector('[data-empty-state-ring="success"]')).toBe(ringBefore);

    // Switching to another room resets the settled guard while its initial index is still pending.
    settled.rerender(
      <CompactRoomEmptyState
        {...settled.props}
        room={makeRoom('!other:example.org')}
        indexPending={true}
      />
    );
    expect(screen.getByRole('status').textContent).toContain('Loading threads');
    expect(screen.queryByRole('heading', { name: 'All caught up' })).toBeNull();

    // Filtered empty state stays interactive immediately while indexPending is true.
    cleanup();
    const pendingForMe = renderEmptyState({
      threadRecordMap: withOpenArrived,
      filterState: unresolvedFilter({ forMe: true }),
      indexPending: true,
    });
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off For me' }));
    expect(pendingForMe.props.onToggleForMe).toHaveBeenCalledTimes(1);

    cleanup();
    const pendingFiltered = renderEmptyState({
      threadRecordMap: withOpenArrived,
      filterState: unresolvedFilter({ freeText: 'missing' }),
      indexPending: true,
    });
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(pendingFiltered.props.onReset).toHaveBeenCalledTimes(1);

    cleanup();
    setReducedMotion(true);
    const reduced = renderEmptyState({ indexPending: false });
    expect(
      reduced.container.querySelector('[data-empty-state-ring="success"]')?.className
    ).not.toContain(css.IconRingSuccessAnimated);
  });

  it('sorts Recently resolved by resolvedTs first and uses resolvedTs for row timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const newestResolvedTs = NOW - 2 * 60_000;
    const midResolvedTs = NOW - 20 * 60_000;
    const oldestResolvedTs = NOW - 4 * 3_600_000;

    const records = new Map<string, ThreadRecord>([
      [
        '$older-activity',
        makeRecord('$older-activity', {
          summaryText: 'Legacy migration',
          isResolved: true,
          lastActivityTs: NOW - 3 * 86_400_000,
        }),
      ],
      [
        '$mid-resolved',
        makeRecord('$mid-resolved', {
          summaryText: 'Billing audit',
          isResolved: true,
          lastActivityTs: NOW - 10 * 60_000,
        }),
      ],
      [
        '$newest-activity',
        makeRecord('$newest-activity', {
          summaryText: 'Daily standup',
          isResolved: true,
          lastActivityTs: NOW - 60_000,
        }),
      ],
    ]);

    const room = makeRoom('!room:example.org', [
      makeResolvedTagEvent('$older-activity', newestResolvedTs),
      makeResolvedTagEvent('$mid-resolved', midResolvedTs),
      makeResolvedTagEvent('$newest-activity', oldestResolvedTs),
    ]);

    const { container } = renderEmptyState({ room, threadRecordMap: records });
    const rows = Array.from(container.querySelectorAll('[data-recent-resolved-row]'));
    expect(rows.map((row) => row.getAttribute('data-recent-resolved-row'))).toEqual([
      '$older-activity',
      '$mid-resolved',
    ]);
    expect(screen.queryByText('Daily standup')).toBeNull();

    const firstTime = rows[0]?.querySelector('[title]');
    expect(firstTime?.textContent).toBe('2m');
    expect(firstTime?.getAttribute('title')).toBe(new Date(newestResolvedTs).toLocaleString('en'));

    const secondTime = rows[1]?.querySelector('[title]');
    expect(secondTime?.textContent).toBe('20m');
    expect(secondTime?.getAttribute('title')).toBe(new Date(midResolvedTs).toLocaleString('en'));
  });

  it('distinguishes For me alone from combined filters and Done/Later tabs without invalid button markup', () => {
    const withOpen = new Map<string, ThreadRecord>([
      ['$open-1', makeRecord('$open-1', { summaryText: 'Open item' })],
      ['$open-2', makeRecord('$open-2', { summaryText: 'Second item' })],
    ]);
    const { props, container } = renderEmptyState({
      threadRecordMap: withOpen,
      filterState: unresolvedFilter({ forMe: true }),
    });

    expect(screen.getByRole('heading', { name: 'No threads match your filters' })).toBeTruthy();
    expect(screen.getByText('2 open threads are hidden by For me.')).toBeTruthy();
    expect(container.querySelectorAll('button p')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Turn off For me' }));
    expect(props.onToggleForMe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);

    // Done tab + For me on must NOT blame For me for open threads.
    cleanup();
    renderEmptyState({
      threadRecordMap: withOpen,
      filterState: {
        ...selectThreadWorkflowTab(createDefaultThreadFilterState(), 'done'),
        forMe: true,
      },
    });
    expect(
      screen.getByText('Adjust or reset your filters to see threads in this room.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn off For me' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeTruthy();

    // Search query + For me on must blame filters generically, not For me alone.
    cleanup();
    renderEmptyState({
      threadRecordMap: withOpen,
      filterState: unresolvedFilter({ forMe: true, freeText: 'release' }),
    });
    expect(screen.getByText('2 open threads are hidden by your filters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn off For me' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeTruthy();

    cleanup();
    const singleOpen = new Map<string, ThreadRecord>([['$open-1', makeRecord('$open-1')]]);
    const generic = renderEmptyState({
      threadRecordMap: singleOpen,
      filterState: unresolvedFilter({ freeText: 'missing' }),
    });
    expect(screen.getByText('1 open thread is hidden by your filters.')).toBeTruthy();
    expect(generic.container.querySelectorAll('button p')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(generic.props.onReset).toHaveBeenCalledTimes(1);
  });

  it('restores keyboard focus to the persistent list container when Reopen unmounts the empty state', () => {
    const onSetResolved = vi.fn();

    function Host() {
      const listRef = useRef<HTMLDivElement>(null);
      const [empty, setEmpty] = useState(true);
      return (
        <div ref={listRef} tabIndex={-1} data-testid="persistent-list">
          {empty ? (
            <CompactRoomEmptyState
              room={makeRoom()}
              threadRecordMap={
                new Map([
                  [
                    '$r1',
                    makeRecord('$r1', {
                      summaryText: 'Weekly triage',
                      isResolved: true,
                      lastActivityTs: NOW - 60_000,
                    }),
                  ],
                ])
              }
              filterState={unresolvedFilter()}
              now={NOW}
              canCompose={true}
              indexPending={false}
              canToggle={true}
              updatingThreadRootIds={new Set()}
              onThreadClick={vi.fn()}
              onSetResolved={(rootId, resolved) => {
                onSetResolved(rootId, resolved);
                setEmpty(false);
              }}
              onReset={vi.fn()}
              onShowSnoozed={vi.fn()}
              onRestoreFocus={() => listRef.current?.focus({ preventScroll: true })}
            />
          ) : (
            <div>Reopened thread card</div>
          )}
        </div>
      );
    }

    render(<Host />);
    const reopen = screen.getByRole('button', { name: 'Reopen thread: Weekly triage' });
    reopen.focus();
    expect(document.activeElement).toBe(reopen);

    // Keyboard activation fires a click with detail === 0.
    fireEvent.click(reopen, { detail: 0 });
    expect(onSetResolved).toHaveBeenCalledWith('$r1', false);
    expect(screen.getByText('Reopened thread card')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('persistent-list'));
    expect(document.activeElement).not.toBe(document.body);
  });
});
