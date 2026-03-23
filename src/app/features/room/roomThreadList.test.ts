import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRoomThreads, roomThreadListIsComplete } from './roomThreadList';

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
  vi.restoreAllMocks();
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
