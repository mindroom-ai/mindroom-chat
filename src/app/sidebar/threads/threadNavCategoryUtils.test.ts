import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import {
  buildSidebarThreadEntries,
  buildSidebarThreadSections,
  MAX_SIDEBAR_RESOLVED_THREADS,
  MAX_SIDEBAR_SNOOZED_THREADS,
  MAX_SIDEBAR_THREADS,
  type SidebarThreadSection,
} from './threadNavCategoryUtils';

const makeEntry = ({
  key,
  lastActivityTs,
  isInvolved = true,
  isResolved = false,
  roomId = key,
}: {
  key: string;
  lastActivityTs: number;
  isInvolved?: boolean;
  isResolved?: boolean;
  roomId?: string;
}): CrossRoomThreadIndexEntry =>
  ({
    key,
    roomId,
    lastActivityTs,
    isInvolved,
    isUnread: false,
    hasAttention: false,
    isResolved,
    roomName: key,
    threadRootId: key,
  } as CrossRoomThreadIndexEntry);

describe('buildSidebarThreadEntries', () => {
  it('keeps pins first in saved order and sorts the rest by last activity', () => {
    const oldestPinned = makeEntry({ key: 'pinned-old', lastActivityTs: 1 });
    const newestPinned = makeEntry({ key: 'pinned-new', lastActivityTs: 10 });
    const older = makeEntry({ key: 'older', lastActivityTs: 20 });
    const newer = makeEntry({ key: 'newer', lastActivityTs: 30 });

    expect(
      buildSidebarThreadEntries(
        [oldestPinned, newer, newestPinned, older],
        ['pinned-old', 'pinned-new']
      ).map((entry) => entry.key)
    ).toEqual(['pinned-old', 'pinned-new', 'newer', 'older']);
  });

  it('includes uninvolved room threads in activity order', () => {
    const newest = makeEntry({ key: 'newest', lastActivityTs: 30, isInvolved: false });
    const pinned = makeEntry({ key: 'pinned', lastActivityTs: 10, isInvolved: false });
    const involved = makeEntry({ key: 'involved', lastActivityTs: 20 });

    expect(
      buildSidebarThreadEntries([newest, involved, pinned], ['pinned']).map((entry) => entry.key)
    ).toEqual(['pinned', 'newest', 'involved']);
  });

  it('excludes resolved threads even when they are pinned', () => {
    const unresolved = makeEntry({ key: 'unresolved', lastActivityTs: 10 });
    const resolved = makeEntry({ key: 'resolved', lastActivityTs: 20, isResolved: true });

    expect(
      buildSidebarThreadEntries([unresolved, resolved], ['resolved']).map((entry) => entry.key)
    ).toEqual(['unresolved']);
  });

  it('drops a snoozed thread from the sidebar until its time passes', () => {
    const open = makeEntry({ key: 'open', lastActivityTs: 10 });
    const snoozed = { ...makeEntry({ key: 'snoozed', lastActivityTs: 20 }), snoozedUntilTs: 500 };
    const keys = (now: number) =>
      buildSidebarThreadEntries([open, snoozed], ['snoozed'], new Set(), 50, now).map(
        (entry) => entry.key
      );

    expect(keys(499)).toEqual(['open']);
    expect(keys(500)).toEqual(['snoozed', 'open']);
  });

  it('excludes threads from direct-message rooms even when they are pinned', () => {
    const roomThread = makeEntry({ key: 'room', lastActivityTs: 10, roomId: '!room' });
    const directThread = makeEntry({ key: 'direct', lastActivityTs: 20, roomId: '!direct' });

    expect(
      buildSidebarThreadEntries([roomThread, directThread], ['direct'], new Set(['!direct'])).map(
        (entry) => entry.key
      )
    ).toEqual(['room']);
  });

  it('caps the compact sidebar list after sorting', () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry({ key: `${index}`, lastActivityTs: index })
    );

    expect(buildSidebarThreadEntries(entries, [], new Set(), 2).map((entry) => entry.key)).toEqual([
      '4',
      '3',
    ]);
  });
});

type SectionEntryOptions = {
  key: string;
  lastActivityTs?: number;
  rootTs?: number;
  oldestTs?: number;
  isStreaming?: boolean;
  hasPendingSend?: boolean;
  hasBackgroundJob?: boolean;
  isResolved?: boolean;
  resolvedTs?: number;
  snoozedUntilTs?: number;
  roomId?: string;
};

const makeSectionEntry = ({
  key,
  lastActivityTs = 0,
  rootTs,
  oldestTs,
  isStreaming = false,
  hasPendingSend = false,
  hasBackgroundJob = false,
  isResolved = false,
  resolvedTs,
  snoozedUntilTs,
  roomId = key,
}: SectionEntryOptions): CrossRoomThreadIndexEntry =>
  ({
    ...makeEntry({ key, lastActivityTs, isResolved, roomId }),
    ...(rootTs !== undefined ? { rootTs } : {}),
    ...(resolvedTs !== undefined ? { resolvedTs } : {}),
    ...(snoozedUntilTs !== undefined ? { snoozedUntilTs } : {}),
    ...(hasBackgroundJob ? { hasBackgroundJob } : {}),
    threadRecord: {
      status: { isStreaming, hasPendingSend },
      cache: oldestTs !== undefined ? { oldestTs } : {},
    },
  } as CrossRoomThreadIndexEntry);

const NO_SIGNALS = () => undefined;

const sectionKeys = (sections: SidebarThreadSection[]) =>
  sections.map(({ id, entries }) => [id, entries.map((entry) => entry.key)]);

describe('buildSidebarThreadSections', () => {
  it('puts each thread in the first section that fits, and leaves out empty ones', () => {
    const entries = [
      makeSectionEntry({
        key: 'streaming-resolved',
        isStreaming: true,
        isResolved: true,
        rootTs: 2,
      }),
      makeSectionEntry({ key: 'sending', hasPendingSend: true, snoozedUntilTs: 1000, rootTs: 1 }),
      makeSectionEntry({ key: 'resolved-snoozed', isResolved: true, snoozedUntilTs: 1000 }),
      makeSectionEntry({ key: 'snoozed', snoozedUntilTs: 1000 }),
      makeSectionEntry({ key: 'idle', lastActivityTs: 5 }),
    ];

    expect(
      sectionKeys(buildSidebarThreadSections(entries, [], new Set(), 100, NO_SIGNALS))
    ).toEqual([
      ['working', ['streaming-resolved', 'sending']],
      ['snoozed', ['snoozed']],
      ['idle', ['idle']],
      ['resolved', ['resolved-snoozed']],
    ]);
    expect(
      sectionKeys(
        buildSidebarThreadSections(
          [makeSectionEntry({ key: 'idle' })],
          [],
          new Set(),
          100,
          NO_SIGNALS
        )
      )
    ).toEqual([['idle', ['idle']]]);
  });

  it('keeps a thread whose agent runs a background job in Working, and lets it go after', () => {
    const withJob = makeSectionEntry({ key: 'job', hasBackgroundJob: true, snoozedUntilTs: 1000 });
    const { hasBackgroundJob: _done, ...afterJob } = withJob;

    expect(
      sectionKeys(buildSidebarThreadSections([withJob], [], new Set(), 100, NO_SIGNALS))
    ).toEqual([['working', ['job']]]);
    expect(
      sectionKeys(buildSidebarThreadSections([afterJob], [], new Set(), 100, NO_SIGNALS))
    ).toEqual([['snoozed', ['job']]]);
  });

  it('moves a snoozed thread to Idle once its time passes', () => {
    const snoozed = makeSectionEntry({ key: 'snoozed', snoozedUntilTs: 500 });
    const sectionOf = (now: number) =>
      buildSidebarThreadSections([snoozed], [], new Set(), now, NO_SIGNALS)[0]?.id;

    expect(sectionOf(499)).toBe('snoozed');
    expect(sectionOf(500)).toBe('idle');
  });

  it('orders Snoozed by the end of the snooze, soonest first', () => {
    const later = makeSectionEntry({ key: 'later', snoozedUntilTs: 900, lastActivityTs: 1 });
    const sooner = makeSectionEntry({ key: 'sooner', snoozedUntilTs: 600, lastActivityTs: 2 });

    expect(
      sectionKeys(buildSidebarThreadSections([later, sooner], [], new Set(), 100, NO_SIGNALS))
    ).toEqual([['snoozed', ['sooner', 'later']]]);
  });

  it('keeps pinned threads first inside their own section, by pin rank', () => {
    const entries = [
      makeSectionEntry({ key: 'new', lastActivityTs: 30 }),
      makeSectionEntry({ key: 'pinned-a', lastActivityTs: 10 }),
      makeSectionEntry({ key: 'pinned-b', lastActivityTs: 20 }),
      makeSectionEntry({ key: 'pinned-working', isStreaming: true, rootTs: 1 }),
      makeSectionEntry({ key: 'working', isStreaming: true, rootTs: 2 }),
    ];

    expect(
      sectionKeys(
        buildSidebarThreadSections(
          entries,
          ['pinned-a', 'pinned-working', 'pinned-b'],
          new Set(),
          100,
          NO_SIGNALS
        )
      )
    ).toEqual([
      ['working', ['pinned-working', 'working']],
      ['idle', ['pinned-a', 'pinned-b', 'new']],
    ]);
  });

  it('orders Working by when each thread started, whatever its replies do', () => {
    const older = makeSectionEntry({ key: 'older', isStreaming: true, rootTs: 100 });
    const newer = makeSectionEntry({ key: 'newer', isStreaming: true, rootTs: 200 });
    const unloadedRoot = makeSectionEntry({ key: 'unloaded', isStreaming: true, oldestTs: 150 });
    const working = (entries: CrossRoomThreadIndexEntry[]) =>
      sectionKeys(buildSidebarThreadSections(entries, [], new Set(), 1000, NO_SIGNALS));

    expect(working([older, newer, unloadedRoot])).toEqual([
      ['working', ['newer', 'unloaded', 'older']],
    ]);
    // The streamed reply of the older thread moves its activity, not its place.
    expect(working([{ ...older, lastActivityTs: 999 }, newer, unloadedRoot])).toEqual([
      ['working', ['newer', 'unloaded', 'older']],
    ]);
  });

  it('orders Idle by when its last run finished, not when its reply started streaming', () => {
    // The reply started at 100 (its activity) and its last edit, the run's end, came at 300.
    const finished = makeSectionEntry({ key: 'finished', lastActivityTs: 100 });
    // A reply sent at 150 and edited at 200.
    const news = makeSectionEntry({ key: 'news', lastActivityTs: 150 });
    const plain = makeSectionEntry({ key: 'plain', lastActivityTs: 250 });
    const signals = new Map([
      [finished.key, { newsTs: 300, outcome: { ts: 300 } }],
      [news.key, { newsTs: 200 }],
    ]);

    expect(
      sectionKeys(
        buildSidebarThreadSections(
          [news, plain, finished],
          [],
          new Set(),
          1000,
          (entry) => signals.get(entry.key) as ThreadSignals | undefined
        )
      )
    ).toEqual([['idle', ['finished', 'plain', 'news']]]);
  });

  it('orders Idle by a newer message over an older run outcome', () => {
    // An agent run ended at 10; a person wrote at 50, and no agent answered.
    const stale = makeSectionEntry({ key: 'stale', lastActivityTs: 50 });
    const other = makeSectionEntry({ key: 'other', lastActivityTs: 30 });
    const signals = new Map([[stale.key, { newsTs: 50, outcome: { ts: 10 } }]]);

    expect(
      sectionKeys(
        buildSidebarThreadSections(
          [other, stale],
          [],
          new Set(),
          1000,
          (entry) => signals.get(entry.key) as ThreadSignals | undefined
        )
      )
    ).toEqual([['idle', ['stale', 'other']]]);
  });

  it('orders Resolved by when it was resolved and caps it apart from the other sections', () => {
    const resolved = Array.from({ length: 25 }, (_, index) =>
      makeSectionEntry({
        key: `resolved-${index}`,
        isResolved: true,
        lastActivityTs: 1000 + index,
        ...(index === 0 ? { resolvedTs: 5000 } : {}),
      })
    );
    const idle = Array.from({ length: 3 }, (_, index) =>
      makeSectionEntry({ key: `idle-${index}`, lastActivityTs: index })
    );
    const working = makeSectionEntry({ key: 'working', isStreaming: true, rootTs: 1 });

    const sections = buildSidebarThreadSections(
      [...resolved, ...idle, working],
      [],
      new Set(),
      100,
      NO_SIGNALS,
      3
    );

    expect(sectionKeys(sections).slice(0, 2)).toEqual([
      ['working', ['working']],
      ['idle', ['idle-2', 'idle-1']],
    ]);
    const resolvedKeys = sections.find(({ id }) => id === 'resolved')?.entries.map((e) => e.key);
    expect(resolvedKeys).toHaveLength(MAX_SIDEBAR_RESOLVED_THREADS);
    expect(resolvedKeys?.slice(0, 3)).toEqual(['resolved-0', 'resolved-24', 'resolved-23']);
  });

  it('gives Snoozed its own cap, so many idle threads leave it its threads', () => {
    const idle = Array.from({ length: 60 }, (_, index) =>
      makeSectionEntry({ key: `idle-${index}`, lastActivityTs: index })
    );
    const snoozed = Array.from({ length: 25 }, (_, index) =>
      makeSectionEntry({ key: `snoozed-${index}`, snoozedUntilTs: 1000 + index })
    );

    const sections = buildSidebarThreadSections(
      [...idle, ...snoozed],
      [],
      new Set(),
      100,
      NO_SIGNALS
    );

    expect(sections.map(({ id, entries }) => [id, entries.length])).toEqual([
      ['snoozed', MAX_SIDEBAR_SNOOZED_THREADS],
      ['idle', MAX_SIDEBAR_THREADS],
    ]);
  });

  it('counts every thread of a section, also those past its cap', () => {
    const idle = Array.from({ length: 60 }, (_, index) =>
      makeSectionEntry({ key: `idle-${index}`, lastActivityTs: index })
    );
    const resolved = Array.from({ length: 25 }, (_, index) =>
      makeSectionEntry({ key: `resolved-${index}`, isResolved: true })
    );

    const sections = buildSidebarThreadSections(
      [...idle, ...resolved],
      [],
      new Set(),
      100,
      NO_SIGNALS
    );

    expect(sections.map(({ id, entries, total }) => [id, entries.length, total])).toEqual([
      ['idle', MAX_SIDEBAR_THREADS, 60],
      ['resolved', MAX_SIDEBAR_RESOLVED_THREADS, 25],
    ]);
  });

  it('leaves out threads of direct-message rooms', () => {
    const roomThread = makeSectionEntry({ key: 'room', roomId: '!room' });
    const directThread = makeSectionEntry({ key: 'direct', roomId: '!direct', isStreaming: true });

    expect(
      sectionKeys(
        buildSidebarThreadSections(
          [roomThread, directThread],
          ['direct'],
          new Set(['!direct']),
          100,
          NO_SIGNALS
        )
      )
    ).toEqual([['idle', ['room']]]);
  });
});
