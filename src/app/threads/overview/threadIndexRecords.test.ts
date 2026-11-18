import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createThreadRecordChanges,
  markThreadRecordChange,
} from '../../event-store/threads/threadRecord';
import {
  buildThreadIndexRecordMaps,
  type BuildThreadIndexRecordMapsOptions,
} from './threadIndexRecords';
import { createEmptyThreadOverviewCachedMetadata } from './threadOverviewCacheMetadata';

const makeEvent = ({
  eventId,
  sender = '@sender:server',
  body = 'body',
  ts = 1000,
}: {
  eventId: string;
  sender?: string;
  body?: string;
  ts?: number;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    getSender: () => sender,
    getContent: () => ({ body, msgtype: 'm.text' }),
    getType: () => 'm.room.message',
    getRelation: () => undefined,
    isRelation: () => false,
    getTs: () => ts,
    replacingEvent: () => undefined,
    getUnsigned: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
  } as unknown as MatrixEvent);

const makeRoom = (rootEvent?: MatrixEvent): Room =>
  ({
    roomId: '!room:server',
    getThread: vi.fn(() => undefined),
    findEventById: vi.fn((eventId: string) =>
      eventId === rootEvent?.getId() ? rootEvent : undefined
    ),
    getUnfilteredTimelineSet: vi.fn(() => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    })),
    getMember: vi.fn(() => undefined),
  } as unknown as Room);

const visibleRootData = {
  ids: ['$root'],
  indexMap: new Map([['$root', 42]]),
  bodyMap: new Map([['$root', 'visible root preview']]),
};

const compactRootData = {
  ids: ['$root'],
  indexMap: new Map([['$root', 7]]),
  bodyMap: new Map([['$root', 'compact live preview']]),
};

/** Options that give no thread anything but its place and preview. */
const emptyOptions = (room: Room): BuildThreadIndexRecordMapsOptions => ({
  threadId: undefined,
  compactViewRequested: true,
  room,
  visibleThreadRootData: visibleRootData,
  compactThreadRootData: compactRootData,
  visibleThreadRootEventMap: new Map(),
  compactThreadRootEventMap: new Map(),
  compactThreadRootBodyMap: new Map(),
  summaryMap: new Map(),
  fallbackSummaryMap: new Map(),
  fallbackReplyCountMap: new Map(),
  cachedMetadata: createEmptyThreadOverviewCachedMetadata(),
  fallbackParticipantMap: new Map(),
  threadResolutionMap: new Map(),
  currentUserId: undefined,
  scheduledStatusMap: new Map(),
  changes: createThreadRecordChanges(),
});

describe('buildThreadIndexRecordMaps', () => {
  it('shares one record-building policy for normal and compact room surfaces', () => {
    const rootEvent = makeEvent({ eventId: '$root', body: 'root event body' });
    const records = buildThreadIndexRecordMaps({
      threadId: undefined,
      compactViewRequested: true,
      room: makeRoom(rootEvent),
      visibleThreadRootData: visibleRootData,
      compactThreadRootData: compactRootData,
      visibleThreadRootEventMap: new Map([['$root', rootEvent]]),
      compactThreadRootEventMap: new Map([['$root', rootEvent]]),
      compactThreadRootBodyMap: new Map([['$root', 'cached compact preview']]),
      summaryMap: new Map([
        [
          '$root',
          {
            summaryText: 'AI summary',
            generatedTs: 1000,
            messageCount: 5,
          },
        ],
      ]),
      fallbackSummaryMap: new Map(),
      fallbackReplyCountMap: new Map([['$root', 2]]),
      cachedMetadata: {
        latestReplyPreviewMap: new Map([['$root', 'cached latest reply']]),
        lastSenderIdMap: new Map([['$root', '@agent:server']]),
        messageCountMap: new Map([['$root', 3]]),
        lastActivityTsMap: new Map([['$root', 2000]]),
        coverageMap: new Map([
          [
            '$root',
            {
              eventCount: 3,
              relationSnapshotComplete: true,
              tailLoaded: true,
            },
          ],
        ]),
      },
      fallbackParticipantMap: new Map([['$root', ['@agent:server']]]),
      threadResolutionMap: new Map([
        [
          '$root',
          {
            isResolved: true,
            tags: { bug: {}, resolved: {} },
          },
        ],
      ]),
      currentUserId: '@me:server',
      scheduledStatusMap: new Map([
        [
          '$root',
          {
            scheduledTaskCount: 1,
            nextScheduledTs: 3000,
          },
        ],
      ]),
      changes: createThreadRecordChanges(),
    });

    expect(records.normalThreadRecordMap.get('$root')).toMatchObject({
      absoluteIndex: 42,
      presentation: {
        summaryText: 'AI summary',
        rootPreviewText: 'visible root preview',
        latestReplyPreviewText: 'cached latest reply',
      },
      status: {
        isResolved: true,
        tags: ['bug'],
        scheduledTaskCount: 1,
      },
      cache: {
        eventCount: 3,
        relationSnapshotComplete: true,
        tailLoaded: true,
      },
    });
    expect(records.compactThreadRecordMap.get('$root')).toMatchObject({
      absoluteIndex: 7,
      presentation: {
        rootPreviewText: 'cached compact preview',
        latestReplyPreviewText: 'cached latest reply',
      },
      status: {
        isResolved: true,
        tags: ['bug'],
        scheduledTaskCount: 1,
      },
      cache: {
        eventCount: 3,
        relationSnapshotComplete: true,
        tailLoaded: true,
      },
    });
  });

  it('does not build room overview records while inside a thread route', () => {
    const records = buildThreadIndexRecordMaps({
      ...emptyOptions(makeRoom()),
      threadId: '$thread',
    });

    expect(records.normalThreadRecordMap.size).toBe(0);
    expect(records.compactThreadRecordMap.size).toBe(0);
  });

  it('keeps the records of both surfaces from the build before when nothing changed', () => {
    const rootEvent = makeEvent({ eventId: '$root' });
    const options = {
      ...emptyOptions(makeRoom(rootEvent)),
      visibleThreadRootEventMap: new Map([['$root', rootEvent]]),
      compactThreadRootEventMap: new Map([['$root', rootEvent]]),
      currentUserId: '@me:server',
    };
    const first = buildThreadIndexRecordMaps(options);

    const second = buildThreadIndexRecordMaps({ ...options, previous: first });

    expect(second.normalThreadRecordMap.get('$root')).toBe(
      first.normalThreadRecordMap.get('$root')
    );
    expect(second.compactThreadRecordMap.get('$root')).toBe(
      first.compactThreadRecordMap.get('$root')
    );
    expect(second.compactThreadRecordMap.get('$root')).not.toBe(
      second.normalThreadRecordMap.get('$root')
    );
  });
});

// One build gives two maps. A thread both list with the same values has one record built, which
// the Compact map takes with its own place; every other record is built on its own. Either way
// each map holds what a build of that map alone gives.
describe('the Compact records of a build that also builds the normal ones', () => {
  const events = new Map(
    ['$a', '$b', '$c', '$d'].map((id) => [id, makeEvent({ eventId: id })] as const)
  );
  const bodies = new Map(['$a', '$b', '$c', '$d'].map((id) => [id, `preview of ${id}`]));
  /** The normal map lists A, B, C; the Compact one C, A, B and D, each at another place. */
  const bothLists = (): BuildThreadIndexRecordMapsOptions => ({
    ...emptyOptions(makeRoom()),
    visibleThreadRootData: {
      ids: ['$a', '$b', '$c'],
      indexMap: new Map([
        ['$a', 10],
        ['$b', 11],
        ['$c', 12],
      ]),
      bodyMap: bodies,
    },
    compactThreadRootData: {
      ids: ['$c', '$a', '$b', '$d'],
      indexMap: new Map([
        ['$c', 3],
        ['$a', 1],
        ['$b', 2],
        ['$d', 0],
      ]),
      bodyMap: bodies,
    },
    visibleThreadRootEventMap: events,
    compactThreadRootEventMap: events,
    compactThreadRootBodyMap: bodies,
    fallbackReplyCountMap: new Map([
      ['$a', 2],
      ['$b', 5],
    ]),
    currentUserId: '@me:server',
  });
  /** Each map as a build of that map alone gives it: nothing of the other to take. */
  const builtAlone = (options: BuildThreadIndexRecordMapsOptions) => ({
    normal: buildThreadIndexRecordMaps({
      ...options,
      compactViewRequested: false,
      previous: undefined,
      changes: createThreadRecordChanges(),
    }).normalThreadRecordMap,
    compact: buildThreadIndexRecordMaps({
      ...options,
      visibleThreadRootData: { ...options.visibleThreadRootData, ids: [] },
      previous: undefined,
      changes: createThreadRecordChanges(),
    }).compactThreadRecordMap,
  });
  /** Both maps hold, in order, what `builtAlone` holds. */
  const expectAsBuiltAlone = (
    options: BuildThreadIndexRecordMapsOptions,
    built = buildThreadIndexRecordMaps(options)
  ) => {
    const alone = builtAlone(options);
    expect([...built.normalThreadRecordMap]).toEqual([...alone.normal]);
    expect([...built.compactThreadRecordMap]).toEqual([...alone.compact]);
    expect([...built.normalThreadRecordMap.keys()]).toEqual(options.visibleThreadRootData.ids);
    expect([...built.compactThreadRecordMap.keys()]).toEqual(options.compactThreadRootData.ids);
    return built;
  };
  /** Whether the Compact map took the normal map's record of `id`: a build makes its own parts. */
  const taken = (built: ReturnType<typeof buildThreadIndexRecordMaps>, id: string) =>
    built.compactThreadRecordMap.get(id)?.presentation ===
    built.normalThreadRecordMap.get(id)?.presentation;

  it('takes the record of a thread both maps list with the same values, at its own place', () => {
    const options = bothLists();
    const built = expectAsBuiltAlone(options);

    expect(['$a', '$b', '$c', '$d'].map((id) => taken(built, id))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(built.normalThreadRecordMap.get('$a')?.absoluteIndex).toBe(10);
    expect(built.compactThreadRecordMap.get('$a')?.absoluteIndex).toBe(1);
    expect(built.compactThreadRecordMap.get('$a')).not.toBe(built.normalThreadRecordMap.get('$a'));
    // Two builds on their own share nothing.
    const alone = builtAlone(options);
    expect(alone.compact.get('$a')?.presentation).not.toBe(alone.normal.get('$a')?.presentation);
  });

  it('holds one record for a thread with the same values at the same place', () => {
    const options = bothLists();
    const built = expectAsBuiltAlone({
      ...options,
      compactThreadRootData: {
        ...options.compactThreadRootData,
        indexMap: new Map([...options.compactThreadRootData.indexMap, ['$a', 10]]),
      },
    });

    expect(built.compactThreadRecordMap.get('$a')).toBe(built.normalThreadRecordMap.get('$a'));
    expect(built.compactThreadRecordMap.get('$b')).not.toBe(built.normalThreadRecordMap.get('$b'));
  });

  it('builds the record of a thread given another value in Compact, or listed only there', () => {
    const options = bothLists();
    const built = expectAsBuiltAlone({
      ...options,
      // A's preview differs, B's root is another event, and D is not in the normal map.
      compactThreadRootBodyMap: new Map([...bodies, ['$a', 'cached preview of $a']]),
      compactThreadRootEventMap: new Map([...events, ['$b', makeEvent({ eventId: '$b' })]]),
    });

    expect(['$a', '$b', '$c', '$d'].map((id) => taken(built, id))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(built.normalThreadRecordMap.get('$a')?.presentation.rootPreviewText).toBe(
      'preview of $a'
    );
    expect(built.compactThreadRecordMap.get('$a')?.presentation.rootPreviewText).toBe(
      'cached preview of $a'
    );
    expect(built.normalThreadRecordMap.size).toBe(3);
    expect(built.compactThreadRecordMap.size).toBe(4);
  });

  it('keeps the records of the build before as it did, and takes only what it would build', () => {
    const options = bothLists();
    const first = buildThreadIndexRecordMaps(options);

    // A change of A alone: each map keeps its own records of the other threads.
    markThreadRecordChange(options.changes, '$a');
    const second = expectAsBuiltAlone(
      options,
      buildThreadIndexRecordMaps({ ...options, previous: first })
    );
    ['$b', '$c', '$d'].forEach((id) => {
      expect(second.normalThreadRecordMap.get(id)).toBe(first.normalThreadRecordMap.get(id));
      expect(second.compactThreadRecordMap.get(id)).toBe(first.compactThreadRecordMap.get(id));
    });
    expect(second.normalThreadRecordMap.get('$a')).not.toBe(first.normalThreadRecordMap.get('$a'));
    expect(taken(second, '$a')).toBe(true);
    expect(second.compactThreadRecordMap.get('$a')?.presentation).not.toBe(
      first.compactThreadRecordMap.get('$a')?.presentation
    );

    // Another preview for B in Compact alone, and no mark: the normal map keeps B's record, and
    // the Compact one builds its own.
    const changed = {
      ...options,
      compactThreadRootBodyMap: new Map([...bodies, ['$b', 'cached preview of $b']]),
    };
    const third = expectAsBuiltAlone(
      changed,
      buildThreadIndexRecordMaps({ ...changed, previous: second })
    );
    expect(third.normalThreadRecordMap.get('$b')).toBe(second.normalThreadRecordMap.get('$b'));
    expect(taken(third, '$b')).toBe(false);
    expect(third.compactThreadRecordMap.get('$a')).toBe(second.compactThreadRecordMap.get('$a'));

    // The same preview again: the normal map's record of B, kept since the first build, stands
    // for these values, and no change was marked for B since.
    const fourth = expectAsBuiltAlone(
      options,
      buildThreadIndexRecordMaps({ ...options, previous: third })
    );
    expect(taken(fourth, '$b')).toBe(true);
    expect(fourth.compactThreadRecordMap.get('$b')?.absoluteIndex).toBe(2);
  });
});
