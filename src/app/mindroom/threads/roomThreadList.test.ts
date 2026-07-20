import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getThreadLastActivityTs,
  getThreadUnread,
  loadRoomThreads,
  roomThreadListIsComplete,
} from './roomThreadList';

const { recordDeepTraceEventMock } = vi.hoisted(() => ({
  recordDeepTraceEventMock: vi.fn(),
}));

vi.mock('../diagnostics/deepTrace', () => ({
  createDeepTraceOperationId: vi.fn(() => 42),
  recordDeepTraceEvent: recordDeepTraceEventMock,
  roundDeepTraceMetric: (value: number) => Math.round(value * 10) / 10,
}));

const setServerSideListSupport = (enabled: boolean) => {
  Thread.hasServerSideListSupport = (enabled ? 2 : 0) as typeof Thread.hasServerSideListSupport;
};

const makeRoom = (tokens: Array<string | null>) => {
  let tokenIndex = 0;

  const liveTimeline = {
    getPaginationToken: vi.fn(() => tokens[tokenIndex] ?? null),
  };
  const paginateEventTimeline = vi.fn(async () => {
    if (tokenIndex < tokens.length - 1) {
      tokenIndex += 1;
    }

    return tokens[tokenIndex] !== null;
  });

  const room = {
    client: {
      paginateEventTimeline,
      supportsThreads: vi.fn(() => true),
    },
    createThreadsTimelineSets: vi.fn(async () => room.threadsTimelineSets),
    fetchRoomThreads: vi.fn(async () => undefined),
    threadsTimelineSets: [
      {
        getLiveTimeline: () => liveTimeline,
      },
    ],
  };

  return {
    room,
    paginateEventTimeline,
  };
};

afterEach(() => {
  Thread.hasServerSideListSupport = 0 as typeof Thread.hasServerSideListSupport;
  recordDeepTraceEventMock.mockClear();
  vi.restoreAllMocks();
});

const makeThreadReplyEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  type = 'm.room.message'
) => ({
  getId: () => eventId,
  getSender: () => sender,
  getTs: () => ts,
  getType: () => type,
  getRelation: () => ({ event_id: '$root', rel_type: 'm.thread' }),
  isRedacted: () => false,
  isRedaction: () => false,
  threadRootId: '$root',
});

describe('loadRoomThreads', () => {
  it('paginates every available server-side thread-list page', async () => {
    setServerSideListSupport(true);
    const progress = vi.fn();
    const { room, paginateEventTimeline } = makeRoom(['page-1', 'page-2', null]);

    await loadRoomThreads(room as never, progress);

    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();
    expect(paginateEventTimeline).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledTimes(3);
  });

  it('stops after the initial fetch when server-side thread lists are unavailable', async () => {
    setServerSideListSupport(false);
    const progress = vi.fn();
    const { room, paginateEventTimeline } = makeRoom(['page-1', null]);

    await loadRoomThreads(room as never, progress);

    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();
    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('breaks out if pagination does not advance the server token', async () => {
    setServerSideListSupport(true);
    const liveTimeline = {
      getPaginationToken: vi.fn(() => 'page-1'),
    };
    const room = {
      client: {
        paginateEventTimeline: vi.fn(async () => true),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };

    await loadRoomThreads(room as never);

    expect(room.client.paginateEventTimeline).toHaveBeenCalledTimes(1);
  });

  it('creates thread timeline sets before the first server-side thread fetch', async () => {
    setServerSideListSupport(true);
    const callOrder: string[] = [];
    const liveTimeline = {
      getPaginationToken: vi.fn(() => null),
    };

    const room = {
      client: {
        paginateEventTimeline: vi.fn(async () => false),
        supportsThreads: vi.fn(() => true),
      },
      createThreadsTimelineSets: vi.fn(async () => {
        callOrder.push('create');
        room.threadsTimelineSets.push({
          getLiveTimeline: () => liveTimeline,
        });
      }),
      fetchRoomThreads: vi.fn(async () => {
        callOrder.push('fetch');
      }),
      threadsTimelineSets: [] as Array<{
        getLiveTimeline: () => typeof liveTimeline;
      }>,
    };

    await loadRoomThreads(room as never);

    expect(room.createThreadsTimelineSets).toHaveBeenCalledOnce();
    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['create', 'fetch']);
  });

  it('warns and continues when timeline sets stay empty after bootstrap', async () => {
    setServerSideListSupport(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const progress = vi.fn();

    const room = {
      client: {
        paginateEventTimeline: vi.fn(async () => false),
        supportsThreads: vi.fn(() => true),
      },
      createThreadsTimelineSets: vi.fn(async () => null),
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [] as Array<{
        getLiveTimeline: () => {
          getPaginationToken: () => null;
        };
      }>,
    };

    await loadRoomThreads(room as never, progress);

    expect(room.createThreadsTimelineSets).toHaveBeenCalledOnce();
    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('[threadList] Timeline sets empty after creation attempt');
  });

  it('warns and returns when the initial thread fetch fails', async () => {
    setServerSideListSupport(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const progress = vi.fn();
    const error = new Error('boom');
    const { room, paginateEventTimeline } = makeRoom(['page-1', null]);
    room.fetchRoomThreads = vi.fn(async () => {
      throw error;
    });

    await loadRoomThreads(room as never, progress);

    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();
    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[threadList] fetchRoomThreads failed:', error);
    expect(recordDeepTraceEventMock).toHaveBeenCalledWith(
      'thread_list.fetch.error',
      expect.objectContaining({ operation_id: 42, duration_ms: expect.any(Number) }),
      { flush: true }
    );
    expect(recordDeepTraceEventMock).toHaveBeenCalledWith(
      'thread_list.load.error',
      expect.objectContaining({ operation_id: 42, duration_ms: expect.any(Number) }),
      { flush: true }
    );
    expect(recordDeepTraceEventMock).not.toHaveBeenCalledWith(
      'thread_list.load.complete',
      expect.anything()
    );
  });
});

describe('thread visibility helpers', () => {
  it('ignores hidden threaded metadata relations when computing last activity', () => {
    const visibleReply = makeThreadReplyEvent('$reply-visible', 200);
    const hiddenThreadTag = makeThreadReplyEvent(
      '$thread-tag',
      320,
      '@alice:example.org',
      'com.mindroom.thread.tag'
    );
    const thread = {
      events: [visibleReply, hiddenThreadTag],
      replyToEvent: hiddenThreadTag,
      rootEvent: { getTs: () => 100 },
    } as never;

    expect(getThreadLastActivityTs(thread)).toBe(200);
  });

  it('does not mark hidden threaded metadata relations as unread', () => {
    const visibleReply = makeThreadReplyEvent('$reply-visible', 200, '@self:example.org');
    const hiddenThreadTag = makeThreadReplyEvent(
      '$thread-tag',
      320,
      '@other:example.org',
      'com.mindroom.thread.tag'
    );
    const room = {
      getEventReadUpTo: vi.fn(() => '$read'),
      findEventById: vi.fn(() => ({ getTs: () => 250 })),
    };
    const thread = {
      events: [visibleReply, hiddenThreadTag],
      replyToEvent: hiddenThreadTag,
      rootEvent: { getTs: () => 100 },
    } as never;

    expect(getThreadUnread(room as never, thread, '@self:example.org')).toBe(false);
  });

  it('uses the thread-scoped read receipt before falling back to the room read marker', () => {
    const visibleReply = makeThreadReplyEvent('$reply-visible', 300, '@other:example.org');
    const room = {
      getEventReadUpTo: vi.fn(() => '$room-read'),
      findEventById: vi.fn(() => ({ getTs: () => 100 })),
    };
    const thread = {
      events: [visibleReply],
      getEventReadUpTo: vi.fn(() => '$reply-visible'),
      replyToEvent: undefined,
      rootEvent: { getTs: () => 50 },
    } as never;

    expect(getThreadUnread(room as never, thread, '@self:example.org')).toBe(false);
  });
});

describe('roomThreadListIsComplete', () => {
  it('returns false until the server-side thread-list token is exhausted', () => {
    setServerSideListSupport(true);
    const { room } = makeRoom(['page-1', null]);

    expect(roomThreadListIsComplete(room as never)).toBe(false);
  });

  it('returns true once the thread-list pagination token is null', () => {
    setServerSideListSupport(true);
    const { room } = makeRoom([null]);

    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });

  it('treats missing timeline sets as locally complete', () => {
    setServerSideListSupport(true);
    const room = {
      threadsTimelineSets: [],
    };

    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });

  it('treats non-server-side thread lists as locally complete', () => {
    setServerSideListSupport(false);
    const { room } = makeRoom(['page-1', null]);

    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });
});
