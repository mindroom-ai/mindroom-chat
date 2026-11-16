import { describe, expect, it } from 'vitest';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
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
    status: { isStreaming: false, isResolved: false, tags: [], ...status },
    cache: oldestTs === undefined ? {} : { oldestTs },
  } as ThreadRecord);

const recordsOf = (...records: ThreadRecord[]) =>
  new Map(records.map((item) => [item.threadRootId, item] as const));

const build = ({
  threadRootIds,
  records,
  jobThreadIds = new Set<string>(),
  entries = new Map<string, Partial<CrossRoomThreadIndexEntry>>(),
  signals = new Map<string, Partial<ThreadSignals>>(),
  pinnedRootIds = [],
}: {
  threadRootIds: string[];
  records: Map<string, ThreadRecord>;
  jobThreadIds?: ReadonlySet<string>;
  entries?: Map<string, Partial<CrossRoomThreadIndexEntry>>;
  signals?: Map<string, Partial<ThreadSignals>>;
  pinnedRootIds?: string[];
}) =>
  buildCompactThreadSections({
    threadRootIds,
    recordMap: records,
    jobThreadIds,
    entryOf: (rootId) => entries.get(rootId) as CrossRoomThreadIndexEntry | undefined,
    signalsOf: (entry) => signals.get(entry.threadRootId) as ThreadSignals | undefined,
    pinnedRootIds,
    now: NOW,
  }).map(({ id, rootIds }) => [id, rootIds]);

describe('buildCompactThreadSections', () => {
  it('puts the cards in Working, Snoozed, Idle and Resolved, and leaves out empty sections', () => {
    const records = recordsOf(
      record('$streaming', { isStreaming: true }),
      record('$job'),
      record('$snoozed', { snoozedUntilTs: NOW + 1 }),
      record('$resolved', { isResolved: true }),
      record('$idle')
    );
    const threadRootIds = ['$streaming', '$job', '$snoozed', '$resolved', '$idle'];

    expect(build({ threadRootIds, records, jobThreadIds: new Set(['$job']) })).toEqual([
      ['working', ['$streaming', '$job']],
      ['snoozed', ['$snoozed']],
      ['idle', ['$idle']],
      ['resolved', ['$resolved']],
    ]);
    expect(build({ threadRootIds: ['$idle'], records })).toEqual([['idle', ['$idle']]]);
  });

  it('moves a thread back out of Working once its background job leaves the state', () => {
    const records = recordsOf(record('$job'));

    expect(build({ threadRootIds: ['$job'], records, jobThreadIds: new Set(['$job']) })).toEqual([
      ['working', ['$job']],
    ]);
    expect(build({ threadRootIds: ['$job'], records })).toEqual([['idle', ['$job']]]);
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

  it('orders Idle by when the last run finished or the newest message came', () => {
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
    ).toEqual([['idle', ['$ran-late', '$wrote-late', '$quiet']]]);
  });

  it('orders Resolved by when it was resolved, and ties in the list order', () => {
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
      ['resolved', ['$b', '$c', '$a']],
    ]);
  });

  it('leads each section with its pinned threads, in pin order', () => {
    const records = recordsOf(
      record('$plain', { lastActivityTs: 900 }),
      record('$pin-2', { lastActivityTs: 1 }),
      record('$pin-1', { lastActivityTs: 2 })
    );

    expect(
      build({
        threadRootIds: ['$plain', '$pin-2', '$pin-1'],
        records,
        pinnedRootIds: ['$pin-1', '$pin-2'],
      })
    ).toEqual([['idle', ['$pin-1', '$pin-2', '$plain']]]);
  });

  it('leaves out a listed thread it has no record of, as the cards do', () => {
    expect(
      build({ threadRootIds: ['$gone', '$here'], records: recordsOf(record('$here')) })
    ).toEqual([['idle', ['$here']]]);
  });
});
