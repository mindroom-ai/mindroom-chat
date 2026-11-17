import { describe, expect, it } from 'vitest';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import {
  createDefaultThreadFilterState,
  selectThreadWorkflowTab,
} from '../../event-store/threads/roomThreadOverviewModel';
import { matchesThreadRecordFilterState } from '../../event-store/threads/threadRecordOverview';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import type { CrossRoomThreadIndexEntry } from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { buildCompactThreadSections } from './compactThreadSections';

const NOW = 1_000;

const record = (
  rootId: string,
  status: Partial<ThreadStatusSnapshot> = {},
  oldestTs?: number
): ThreadRecord =>
  ({
    roomId: '!room:x',
    threadRootId: rootId,
    status: { isStreaming: false, isResolved: false, scheduledTaskCount: 0, tags: [], ...status },
    cache: oldestTs === undefined ? {} : { oldestTs },
  } as ThreadRecord);

const recordsOf = (...records: ThreadRecord[]) =>
  new Map(records.map((item) => [item.threadRootId, item] as const));

const build = ({
  threadRootIds,
  records,
  entries = new Map<string, Partial<CrossRoomThreadIndexEntry>>(),
  signals = new Map<string, Partial<ThreadSignals>>(),
  pinnedRootIds = [],
}: {
  threadRootIds: string[];
  records: Map<string, ThreadRecord>;
  entries?: Map<string, Partial<CrossRoomThreadIndexEntry>>;
  signals?: Map<string, Partial<ThreadSignals>>;
  pinnedRootIds?: string[];
}) =>
  buildCompactThreadSections({
    threadRootIds,
    recordMap: records,
    entryOf: (rootId) => entries.get(rootId) as CrossRoomThreadIndexEntry | undefined,
    signalsOf: (entry) => signals.get(entry.threadRootId) as ThreadSignals | undefined,
    pinnedRootIds,
    now: NOW,
  }).map(({ id, rootIds }) => [id, rootIds]);

/** One thread of each kind the workflow classifier tells apart. */
const everyKind = recordsOf(
  record('$streaming', { isStreaming: true }),
  record('$job', { hasBackgroundJob: true }),
  record('$approval', { hasBackgroundJob: true, hasBackgroundApproval: true }),
  record('$scheduled', { scheduledTaskCount: 1, nextScheduledTs: NOW + 10 }),
  record('$snoozed', { snoozedUntilTs: NOW + 50 }),
  record('$resolved', { isResolved: true, isStreaming: true }),
  record('$sending', { hasPendingSend: true }),
  record('$read')
);
const everyKindIds = [...everyKind.keys()];

describe('buildCompactThreadSections', () => {
  it('puts the cards in Working, Needs you, Later and Done, as the workflow tabs count them', () => {
    expect(build({ threadRootIds: everyKindIds, records: everyKind })).toEqual([
      ['working', ['$streaming', '$job']],
      ['needsYou', ['$approval', '$sending', '$read']],
      ['later', ['$scheduled', '$snoozed']],
      ['done', ['$resolved']],
    ]);
  });

  it('leaves out empty sections', () => {
    expect(build({ threadRootIds: ['$read'], records: everyKind })).toEqual([
      ['needsYou', ['$read']],
    ]);
  });

  it.each<ThreadWorkflowBucket>(['working', 'needsYou', 'later', 'done'])(
    'shows only the %s section while that tab filters the cards',
    (tab) => {
      const state = selectThreadWorkflowTab(createDefaultThreadFilterState(), tab);
      const threadRootIds = everyKindIds.filter((rootId) => {
        const item = everyKind.get(rootId);
        return item !== undefined && matchesThreadRecordFilterState(item, state, NOW);
      });

      expect(build({ threadRootIds, records: everyKind }).map(([id]) => id)).toEqual([tab]);
    }
  );

  it('moves a thread out of Working once its record carries no live job', () => {
    expect(
      build({
        threadRootIds: ['$job'],
        records: recordsOf(record('$job', { hasBackgroundJob: true })),
      })
    ).toEqual([['working', ['$job']]]);
    expect(build({ threadRootIds: ['$job'], records: recordsOf(record('$job')) })).toEqual([
      ['needsYou', ['$job']],
    ]);
  });

  it('moves a snoozed thread to Needs you once its snooze has ended', () => {
    const records = recordsOf(record('$woke', { snoozedUntilTs: NOW - 1 }));

    expect(build({ threadRootIds: ['$woke'], records })).toEqual([['needsYou', ['$woke']]]);
  });

  it('orders Working by when each thread started, from the index entry or the cache', () => {
    const records = recordsOf(
      record('$old', { isStreaming: true, lastActivityTs: 900 }),
      record('$new', { isStreaming: true, lastActivityTs: 100 }, 50)
    );
    const entries = new Map([['$old', { rootTs: 10 }]]);

    expect(build({ threadRootIds: ['$old', '$new'], records, entries })).toEqual([
      ['working', ['$new', '$old']],
    ]);
  });

  it('orders Needs you by when the last run finished or the newest message came', () => {
    const records = recordsOf(
      record('$ran-late', { lastActivityTs: 100 }),
      record('$wrote-late', { lastActivityTs: 100 }),
      record('$quiet', { lastActivityTs: 300 })
    );
    const entries = new Map(
      ['$ran-late', '$wrote-late'].map((rootId) => [rootId, { threadRootId: rootId }])
    );
    const signals = new Map([
      ['$ran-late', { outcome: { kind: 'finished', senderId: '@a:x', ts: 500, durationMs: 1 } }],
      ['$wrote-late', { newsTs: 400 }],
    ] as const);

    expect(
      build({ threadRootIds: ['$quiet', '$wrote-late', '$ran-late'], records, entries, signals })
    ).toEqual([['needsYou', ['$ran-late', '$wrote-late', '$quiet']]]);
  });

  it('orders Later by when each thread comes back, soonest first, unknown times last', () => {
    const records = recordsOf(
      record('$unknown', { scheduledTaskCount: 1 }),
      record('$snoozed-late', { snoozedUntilTs: NOW + 90, nextScheduledTs: NOW + 5 }),
      record('$scheduled-soon', { scheduledTaskCount: 2, nextScheduledTs: NOW + 20 }),
      record('$snoozed-soon', { snoozedUntilTs: NOW + 10 })
    );

    expect(
      build({
        threadRootIds: ['$unknown', '$snoozed-late', '$scheduled-soon', '$snoozed-soon'],
        records,
      })
    ).toEqual([['later', ['$snoozed-soon', '$scheduled-soon', '$snoozed-late', '$unknown']]]);
  });

  it('orders Done by when it was resolved, and ties in the list order', () => {
    const records = recordsOf(
      record('$a', { isResolved: true }),
      record('$b', { isResolved: true }),
      record('$c', { isResolved: true })
    );
    const entries = new Map([
      ['$a', { resolvedTs: 5 }],
      ['$b', { resolvedTs: 9 }],
      ['$c', { resolvedTs: 5 }],
    ]);

    expect(build({ threadRootIds: ['$c', '$a', '$b'], records, entries })).toEqual([
      ['done', ['$b', '$c', '$a']],
    ]);
  });

  it('leads each section with its pinned threads, in pin order', () => {
    const records = recordsOf(
      record('$plain', { lastActivityTs: 900 }),
      record('$pin-2', { lastActivityTs: 1 }),
      record('$pin-1', { lastActivityTs: 2 }),
      record('$later', { snoozedUntilTs: NOW + 1 }),
      record('$later-pin', { snoozedUntilTs: NOW + 99 })
    );

    expect(
      build({
        threadRootIds: ['$plain', '$pin-2', '$pin-1', '$later', '$later-pin'],
        records,
        pinnedRootIds: ['$pin-1', '$later-pin', '$pin-2'],
      })
    ).toEqual([
      ['needsYou', ['$pin-1', '$pin-2', '$plain']],
      ['later', ['$later-pin', '$later']],
    ]);
  });

  it('leaves out a listed thread it has no record of, as the cards do', () => {
    expect(
      build({ threadRootIds: ['$gone', '$here'], records: recordsOf(record('$here')) })
    ).toEqual([['needsYou', ['$here']]]);
  });
});
