import { describe, expect, it, vi } from 'vitest';
import type { ThreadOverviewMetadata } from './roomThreadOverviewModel';

vi.mock('../../hooks/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: (_room: unknown, threadRootId: string) => {
    const map: Record<string, number> = {
      '$thread-1': 1000,
      '$thread-2': 2000,
      '$thread-3': 3000,
      '$thread-streaming': 2500,
      '$thread-scheduled': 1500,
    };
    return map[threadRootId] ?? 0;
  },
}));

vi.mock('../../hooks/useThreadStreamingState', () => ({
  getThreadStreamingState: (_room: unknown, threadRootId: string) =>
    threadRootId === '$thread-streaming',
}));

vi.mock('../../utils/scheduledTaskContract', () => ({
  parseScheduledTaskStateEvent: (event: {
    getStateKey: () => string;
    getContent: () => Record<string, unknown>;
  }) => {
    const content = event.getContent();
    return {
      taskId: event.getStateKey(),
      status: content.status as string,
      threadId: content.thread_id as string | null,
      newThread: content.new_thread as boolean,
      executeAt: content.execute_at as string | null,
    };
  },
}));

describe('roomThreadOverviewModel', () => {
  describe('getRoomScheduledTaskCounts', () => {
    it('groups pending future scheduled tasks by threadId', async () => {
      const { getRoomScheduledTaskCounts } = await import('./roomThreadOverviewModel');

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      const events = [
        {
          getStateKey: () => 'task-1',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-1',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        {
          getStateKey: () => 'task-2',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-1',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        {
          getStateKey: () => 'task-3',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-2',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        // Should be excluded: completed
        {
          getStateKey: () => 'task-4',
          getContent: () => ({
            status: 'completed',
            thread_id: '$thread-1',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        // Should be excluded: newThread
        {
          getStateKey: () => 'task-5',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-1',
            new_thread: true,
            execute_at: futureDate,
          }),
        },
        // Should be excluded: past executeAt
        {
          getStateKey: () => 'task-6',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-3',
            new_thread: false,
            execute_at: pastDate,
          }),
        },
        // Should be excluded: no threadId
        {
          getStateKey: () => 'task-7',
          getContent: () => ({
            status: 'pending',
            thread_id: null,
            new_thread: false,
            execute_at: futureDate,
          }),
        },
      ];

      const result = getRoomScheduledTaskCounts(events as never);
      expect(result.get('$thread-1')).toBe(2);
      expect(result.get('$thread-2')).toBe(1);
      expect(result.has('$thread-3')).toBe(false);
    });
  });

  describe('isThreadUnread', () => {
    const makeThread = (replies: Array<{ sender: string; ts: number }>) => ({
      events: replies.map((r) => ({
        getSender: () => r.sender,
        getTs: () => r.ts,
      })),
    });

    const makeRoom = (threads: Map<string, ReturnType<typeof makeThread>>) => ({
      getThread: (id: string) => threads.get(id) ?? null,
    });

    it('returns true when last reply is from another user and newer than read marker', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([['$t1', makeThread([{ sender: '@bob:x', ts: 200 }])]])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 100)).toBe(true);
    });

    it('returns false when user sent the last reply', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([
          [
            '$t1',
            makeThread([
              { sender: '@bob:x', ts: 100 },
              { sender: '@alice:x', ts: 200 },
            ]),
          ],
        ])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 50)).toBe(false);
    });

    it('returns false when no thread exists', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(new Map());
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 100)).toBe(false);
    });

    it('returns true when no read marker exists and there is reply from another user', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([['$t1', makeThread([{ sender: '@bob:x', ts: 50 }])]])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', undefined)).toBe(true);
    });

    it('returns false when reply is older than read marker', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([['$t1', makeThread([{ sender: '@bob:x', ts: 50 }])]])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 100)).toBe(false);
    });
  });

  describe('filterThreadRootEvents', () => {
    const metadataMap = new Map<string, ThreadOverviewMetadata>([
      [
        '$unresolved',
        {
          isResolved: false,
          isUnread: true,
          isStreaming: false,
          scheduledTaskCount: 0,
          lastActivityTs: 100,
          absoluteIndex: 0,
        },
      ],
      [
        '$resolved',
        {
          isResolved: true,
          isUnread: false,
          isStreaming: false,
          scheduledTaskCount: 0,
          lastActivityTs: 200,
          absoluteIndex: 1,
        },
      ],
      [
        '$unread',
        {
          isResolved: false,
          isUnread: true,
          isStreaming: false,
          scheduledTaskCount: 0,
          lastActivityTs: 300,
          absoluteIndex: 2,
        },
      ],
    ]);

    const ids = ['$unresolved', '$resolved', '$unread'];

    it('returns all IDs for filter=all', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(filterThreadRootEvents(ids, 'all', metadataMap)).toEqual(ids);
    });

    it('returns only unresolved threads', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(filterThreadRootEvents(ids, 'unresolved', metadataMap)).toEqual([
        '$unresolved',
        '$unread',
      ]);
    });

    it('returns only resolved threads', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(filterThreadRootEvents(ids, 'resolved', metadataMap)).toEqual(['$resolved']);
    });

    it('returns only unread threads', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(filterThreadRootEvents(ids, 'unread', metadataMap)).toEqual([
        '$unresolved',
        '$unread',
      ]);
    });
  });

  describe('sortThreadRootEvents', () => {
    const metadataMap = new Map<string, ThreadOverviewMetadata>([
      [
        '$thread-1',
        {
          isResolved: false,
          isUnread: false,
          isStreaming: false,
          scheduledTaskCount: 0,
          lastActivityTs: 1000,
          absoluteIndex: 0,
        },
      ],
      [
        '$thread-2',
        {
          isResolved: false,
          isUnread: false,
          isStreaming: false,
          scheduledTaskCount: 0,
          lastActivityTs: 2000,
          absoluteIndex: 1,
        },
      ],
      [
        '$thread-3',
        {
          isResolved: false,
          isUnread: false,
          isStreaming: false,
          scheduledTaskCount: 0,
          lastActivityTs: 3000,
          absoluteIndex: 2,
        },
      ],
    ]);

    const ids = ['$thread-1', '$thread-2', '$thread-3'];

    it('returns events unchanged for sort=default', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(sortThreadRootEvents(ids, 'default', metadataMap)).toEqual(ids);
    });

    it('orders by lastActivityTs descending for sort=last-reply', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(sortThreadRootEvents(ids, 'last-reply', metadataMap)).toEqual([
        '$thread-3',
        '$thread-2',
        '$thread-1',
      ]);
    });

    it('puts streaming threads first for sort=streaming', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      const streamingMap = new Map<string, ThreadOverviewMetadata>([
        ...metadataMap,
        [
          '$thread-streaming',
          {
            isResolved: false,
            isUnread: false,
            isStreaming: true,
            scheduledTaskCount: 0,
            lastActivityTs: 2500,
            absoluteIndex: 3,
          },
        ],
      ]);
      const allIds = [...ids, '$thread-streaming'];
      expect(sortThreadRootEvents(allIds, 'streaming', streamingMap)).toEqual([
        '$thread-streaming',
        '$thread-3',
        '$thread-2',
        '$thread-1',
      ]);
    });

    it('puts scheduled threads first for sort=scheduled', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      const scheduledMap = new Map<string, ThreadOverviewMetadata>([
        ...metadataMap,
        [
          '$thread-scheduled',
          {
            isResolved: false,
            isUnread: false,
            isStreaming: false,
            scheduledTaskCount: 2,
            lastActivityTs: 1500,
            absoluteIndex: 3,
          },
        ],
      ]);
      const allIds = [...ids, '$thread-scheduled'];
      expect(sortThreadRootEvents(allIds, 'scheduled', scheduledMap)).toEqual([
        '$thread-scheduled',
        '$thread-3',
        '$thread-2',
        '$thread-1',
      ]);
    });

    it('stable tie-breaking: events with equal timestamps sort by absoluteIndex', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      const tiedMap = new Map<string, ThreadOverviewMetadata>([
        [
          '$a',
          {
            isResolved: false,
            isUnread: false,
            isStreaming: false,
            scheduledTaskCount: 0,
            lastActivityTs: 1000,
            absoluteIndex: 2,
          },
        ],
        [
          '$b',
          {
            isResolved: false,
            isUnread: false,
            isStreaming: false,
            scheduledTaskCount: 0,
            lastActivityTs: 1000,
            absoluteIndex: 0,
          },
        ],
        [
          '$c',
          {
            isResolved: false,
            isUnread: false,
            isStreaming: false,
            scheduledTaskCount: 0,
            lastActivityTs: 1000,
            absoluteIndex: 1,
          },
        ],
      ]);
      expect(sortThreadRootEvents(['$a', '$b', '$c'], 'last-reply', tiedMap)).toEqual([
        '$b',
        '$c',
        '$a',
      ]);
    });
  });

  describe('computeOverviewCounts', () => {
    it('produces correct counts from metadata map', async () => {
      const { computeOverviewCounts } = await import('./roomThreadOverviewModel');
      const metadataMap = new Map<string, ThreadOverviewMetadata>([
        [
          '$a',
          {
            isResolved: false,
            isUnread: true,
            isStreaming: false,
            scheduledTaskCount: 0,
            lastActivityTs: 0,
            absoluteIndex: 0,
          },
        ],
        [
          '$b',
          {
            isResolved: true,
            isUnread: false,
            isStreaming: false,
            scheduledTaskCount: 0,
            lastActivityTs: 0,
            absoluteIndex: 1,
          },
        ],
        [
          '$c',
          {
            isResolved: false,
            isUnread: true,
            isStreaming: false,
            scheduledTaskCount: 0,
            lastActivityTs: 0,
            absoluteIndex: 2,
          },
        ],
      ]);

      expect(computeOverviewCounts(metadataMap)).toEqual({
        all: 3,
        unresolved: 2,
        resolved: 1,
        unread: 2,
      });
    });
  });

  describe('buildThreadMetadataMap', () => {
    it('produces correct metadata for mixed thread states', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const room = {
        getThread: (id: string) =>
          id === '$thread-1'
            ? {
                events: [{ getSender: () => '@bob:x', getTs: () => 500 }],
              }
            : null,
      };
      const resolutionMap = new Map([['$thread-2', { isResolved: true }]]);
      const scheduledCounts = new Map([['$thread-1', 3]]);
      const absoluteIndexMap = new Map([
        ['$thread-1', 0],
        ['$thread-2', 5],
        ['$thread-streaming', 10],
      ]);

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1', '$thread-2', '$thread-streaming'],
        resolutionMap,
        scheduledCounts,
        '@alice:x',
        100,
        absoluteIndexMap
      );

      expect(result.get('$thread-1')).toEqual({
        isResolved: false,
        isUnread: true,
        isStreaming: false,
        scheduledTaskCount: 3,
        lastActivityTs: 1000,
        absoluteIndex: 0,
      });

      expect(result.get('$thread-2')).toEqual({
        isResolved: true,
        isUnread: false,
        isStreaming: false,
        scheduledTaskCount: 0,
        lastActivityTs: 2000,
        absoluteIndex: 5,
      });

      expect(result.get('$thread-streaming')).toEqual({
        isResolved: false,
        isUnread: false,
        isStreaming: true,
        scheduledTaskCount: 0,
        lastActivityTs: 2500,
        absoluteIndex: 10,
      });
    });
  });
});
