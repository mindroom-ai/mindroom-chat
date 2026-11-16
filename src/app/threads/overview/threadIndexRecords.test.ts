import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createThreadRecordChanges } from '../../event-store/threads/threadRecord';
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
