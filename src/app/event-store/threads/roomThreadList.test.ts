import { EventEmitter } from 'events';
import { RoomEvent, type MatrixClient } from 'matrix-js-sdk';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getThreadLastActivityTs,
  getThreadUnread,
  loadRoomThreads,
  roomThreadListIsComplete,
} from './roomThreadList';
import { relistThreadsAfterGaps } from '../../matrix/client/threadListGaps';

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
    createThreadsTimelineSets: vi.fn(async (): Promise<unknown> => room.threadsTimelineSets),
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
  getContent: () => ({ msgtype: 'm.text', body: eventId }),
  getRelation: () => ({ event_id: '$root', rel_type: 'm.thread' }),
  isRedacted: () => false,
  isRedaction: () => false,
  threadRootId: '$root',
});

describe('loadRoomThreads', () => {
  it.each([false, true])(
    'waits for capability discovery before loading (cancelled: %s)',
    async (cancelled) => {
      const { room } = makeRoom([null]);
      let discover!: () => void;
      const pending = new Promise<void>((resolve) => {
        discover = resolve;
      });
      Object.assign(room.client, { threadSupportPending: pending });
      const controller = new AbortController();
      const loading = loadRoomThreads(room as never, undefined, controller.signal);
      await Promise.resolve();
      await Promise.resolve();
      expect(room.fetchRoomThreads).not.toHaveBeenCalled();
      if (cancelled) controller.abort();
      setServerSideListSupport(true);
      discover();
      await loading;
      expect(room.fetchRoomThreads).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    }
  );

  it('shares an in-flight room load across compact-mode remounts', async () => {
    setServerSideListSupport(true);
    let releaseFetch: (() => void) | undefined;
    const fetchPending = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const liveTimeline = {
      getPaginationToken: vi.fn(() => null),
    };
    const room = {
      client: {
        paginateEventTimeline: vi.fn(async () => false),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(() => fetchPending),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();

    const firstLoad = loadRoomThreads(room as never, firstProgress);
    await vi.waitFor(() => expect(room.fetchRoomThreads).toHaveBeenCalledOnce());
    const secondLoad = loadRoomThreads(room as never, secondProgress);

    await Promise.resolve();
    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();

    releaseFetch?.();
    await Promise.all([firstLoad, secondLoad]);

    expect(firstProgress).toHaveBeenCalledOnce();
    expect(secondProgress).toHaveBeenCalledOnce();
  });

  it('continues a shared load when one progress listener throws', async () => {
    setServerSideListSupport(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room } = makeRoom([null]);
    const listenerError = new Error('progress listener failed');
    const secondProgress = vi.fn();

    const firstLoad = loadRoomThreads(room as never, () => {
      throw listenerError;
    });
    const secondLoad = loadRoomThreads(room as never, secondProgress);

    await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([undefined, undefined]);
    expect(secondProgress).toHaveBeenCalledOnce();
  });

  it('notifies a caller that joins after fetch progress while pagination is pending', async () => {
    setServerSideListSupport(true);
    let releasePagination: ((hasMore: boolean) => void) | undefined;
    const pendingPagination = new Promise<boolean>((resolve) => {
      releasePagination = resolve;
    });
    let paginationToken: string | null = 'next';
    const liveTimeline = {
      getPaginationToken: vi.fn(() => paginationToken),
    };
    const room = {
      client: {
        paginateEventTimeline: vi.fn(() => pendingPagination),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();

    const firstLoad = loadRoomThreads(room as never, firstProgress);
    await vi.waitFor(() => expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce());
    expect(firstProgress).toHaveBeenCalledOnce();

    const secondLoad = loadRoomThreads(room as never, secondProgress);
    paginationToken = null;
    releasePagination?.(false);
    await Promise.all([firstLoad, secondLoad]);

    expect(secondProgress).toHaveBeenCalledOnce();
  });

  it('does not start another page after the last interested caller aborts', async () => {
    setServerSideListSupport(true);
    const controller = new AbortController();
    let releasePagination: ((hasMore: boolean) => void) | undefined;
    let paginationToken: string | null = 'page-1';
    const liveTimeline = {
      getPaginationToken: vi.fn(() => paginationToken),
    };
    const room = {
      client: {
        paginateEventTimeline: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              releasePagination = resolve;
            })
        ),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };

    const load = loadRoomThreads(room as never, undefined, controller.signal);
    await vi.waitFor(() => expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce());

    controller.abort();
    paginationToken = 'page-2';
    releasePagination?.(true);
    await load;

    expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce();
  });

  it('continues pagination while an unsignaled shared caller remains interested', async () => {
    setServerSideListSupport(true);
    const firstController = new AbortController();
    let releaseFirstPage: ((hasMore: boolean) => void) | undefined;
    let paginationToken: string | null = 'page-1';
    const liveTimeline = {
      getPaginationToken: vi.fn(() => paginationToken),
    };
    const room = {
      client: {
        paginateEventTimeline: vi
          .fn<() => Promise<boolean>>()
          .mockImplementationOnce(
            () =>
              new Promise<boolean>((resolve) => {
                releaseFirstPage = resolve;
              })
          )
          .mockImplementationOnce(async () => {
            paginationToken = null;
            return false;
          }),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };

    const firstLoad = loadRoomThreads(room as never, undefined, firstController.signal);
    const secondLoad = loadRoomThreads(room as never);
    await vi.waitFor(() => expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce());

    firstController.abort();
    paginationToken = 'page-2';
    releaseFirstPage?.(true);
    await Promise.all([firstLoad, secondLoad]);

    expect(room.client.paginateEventTimeline).toHaveBeenCalledTimes(2);
  });

  it('reattaches a returning caller while an abandoned page is still pending', async () => {
    setServerSideListSupport(true);
    const controller = new AbortController();
    let releaseFirstPage: ((hasMore: boolean) => void) | undefined;
    let paginationToken: string | null = 'page-1';
    const liveTimeline = {
      getPaginationToken: vi.fn(() => paginationToken),
    };
    const room = {
      client: {
        paginateEventTimeline: vi
          .fn<() => Promise<boolean>>()
          .mockImplementationOnce(
            () =>
              new Promise<boolean>((resolve) => {
                releaseFirstPage = resolve;
              })
          )
          .mockImplementationOnce(async () => {
            paginationToken = null;
            return false;
          }),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };

    const abandonedLoad = loadRoomThreads(room as never, undefined, controller.signal);
    await vi.waitFor(() => expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce());

    controller.abort();
    const resumedLoad = loadRoomThreads(room as never);
    paginationToken = 'page-2';
    releaseFirstPage?.(true);
    await Promise.all([abandonedLoad, resumedLoad]);

    expect(room.fetchRoomThreads).toHaveBeenCalledOnce();
    expect(room.client.paginateEventTimeline).toHaveBeenCalledTimes(2);
  });

  it('resumes the remaining pages when a caller returns after cancellation settles', async () => {
    setServerSideListSupport(true);
    const controller = new AbortController();
    let releaseFirstPage: ((hasMore: boolean) => void) | undefined;
    let paginationToken: string | null = 'page-1';
    const liveTimeline = {
      getPaginationToken: vi.fn(() => paginationToken),
    };
    const room = {
      client: {
        paginateEventTimeline: vi
          .fn<() => Promise<boolean>>()
          .mockImplementationOnce(
            () =>
              new Promise<boolean>((resolve) => {
                releaseFirstPage = resolve;
              })
          )
          .mockImplementationOnce(async () => {
            paginationToken = null;
            return false;
          }),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };

    const abandonedLoad = loadRoomThreads(room as never, undefined, controller.signal);
    await vi.waitFor(() => expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce());

    controller.abort();
    paginationToken = 'page-2';
    releaseFirstPage?.(true);
    await abandonedLoad;

    await loadRoomThreads(room as never);

    expect(room.fetchRoomThreads).toHaveBeenCalledTimes(2);
    expect(room.client.paginateEventTimeline).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh load before the previous success is observable to callers', async () => {
    setServerSideListSupport(true);
    let releaseFetch: (() => void) | undefined;
    const firstFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const room = {
      client: {
        paginateEventTimeline: vi.fn(async () => false),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi
        .fn<() => Promise<void>>()
        .mockReturnValueOnce(firstFetch)
        .mockResolvedValueOnce(undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => ({
            getPaginationToken: vi.fn(() => null),
          }),
        },
      ],
    };

    const firstLoad = loadRoomThreads(room as never);
    await vi.waitFor(() => expect(room.fetchRoomThreads).toHaveBeenCalledOnce());

    releaseFetch?.();
    const followUpLoad = Promise.resolve().then(() => loadRoomThreads(room as never));
    await Promise.all([firstLoad, followUpLoad]);

    expect(room.fetchRoomThreads).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh load before the previous rejection is observable to callers', async () => {
    setServerSideListSupport(true);
    let rejectPagination: ((reason: Error) => void) | undefined;
    const firstPagination = new Promise<boolean>((_resolve, reject) => {
      rejectPagination = reject;
    });
    const liveTimeline = {
      getPaginationToken: vi.fn(() => 'next'),
    };
    const room = {
      client: {
        paginateEventTimeline: vi
          .fn<() => Promise<boolean>>()
          .mockReturnValueOnce(firstPagination)
          .mockResolvedValueOnce(false),
        supportsThreads: vi.fn(() => true),
      },
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [
        {
          getLiveTimeline: () => liveTimeline,
        },
      ],
    };

    const firstLoad = loadRoomThreads(room as never);
    const firstLoadResult = expect(firstLoad).rejects.toThrow('pagination failed');
    await vi.waitFor(() => expect(room.client.paginateEventTimeline).toHaveBeenCalledOnce());

    rejectPagination?.(new Error('pagination failed'));
    const followUpLoad = Promise.resolve().then(() => loadRoomThreads(room as never));
    await firstLoadResult;
    await followUpLoad;

    expect(room.fetchRoomThreads).toHaveBeenCalledTimes(2);
    expect(room.client.paginateEventTimeline).toHaveBeenCalledTimes(2);
  });

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
    const thread = {
      events: [visibleReply, hiddenThreadTag],
      replyToEvent: hiddenThreadTag,
      rootEvent: { getTs: () => 100 },
    } as never;

    expect(getThreadUnread(thread, '@self:example.org')).toBe(false);
  });

  it('uses the thread-scoped read receipt', () => {
    const visibleReply = makeThreadReplyEvent('$reply-visible', 300, '@other:example.org');
    const thread = {
      events: [visibleReply],
      getEventReadUpTo: vi.fn(() => '$reply-visible'),
      getLastUnthreadedReceiptFor: vi.fn(() => undefined),
      getReadReceiptForUserId: vi.fn(() => null),
      replyToEvent: undefined,
      rootEvent: { getTs: () => 50 },
    } as never;

    expect(getThreadUnread(thread, '@self:example.org')).toBe(false);
  });
});

describe('roomThreadListIsComplete', () => {
  it('returns false until the server-side thread-list token is exhausted', () => {
    setServerSideListSupport(true);
    const { room } = makeRoom(['page-1', null]);

    expect(roomThreadListIsComplete(room as never)).toBe(false);
  });

  it('returns true once the thread-list pagination token is null', async () => {
    setServerSideListSupport(true);
    const { room } = makeRoom([null]);
    await loadRoomThreads(room as never);

    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });

  it('returns false until the first page of the list arrives', async () => {
    // A new timeline has no token either, so only the first page tells an empty list from a done one.
    setServerSideListSupport(true);
    const { room } = makeRoom([null]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(roomThreadListIsComplete(room as never)).toBe(false);
    room.fetchRoomThreads.mockRejectedValueOnce(new Error('offline'));
    await loadRoomThreads(room as never);
    expect(roomThreadListIsComplete(room as never)).toBe(false);
    await loadRoomThreads(room as never);
    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });

  it('treats missing timeline sets as locally complete', async () => {
    setServerSideListSupport(true);
    const room = {
      client: { supportsThreads: vi.fn(() => true) },
      createThreadsTimelineSets: vi.fn(async () => undefined),
      fetchRoomThreads: vi.fn(async () => undefined),
      threadsTimelineSets: [],
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadRoomThreads(room as never);

    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });

  it('treats non-server-side thread lists as locally complete', () => {
    setServerSideListSupport(false);
    const { room } = makeRoom(['page-1', null]);

    expect(roomThreadListIsComplete(room as never)).toBe(true);
  });
});

describe('loadRoomThreads and the gap relist', () => {
  /** A room whose first thread list page answers when the test says, on a client that relists after gaps. */
  const setupGapRoom = () => {
    const unfiltered = {};
    let answer!: (value: void) => void;
    let fail!: (error: unknown) => void;
    const firstPage = new Promise<void>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
    const requests: (string | null)[] = [];
    const client = Object.assign(new EventEmitter(), {
      supportsThreads: () => true,
      getSyncState: () => null,
      getRooms: () => [room],
      getEventMapper: () => (event: unknown) => event,
      createThreadListMessagesRequest: vi.fn(async (_roomId: string, from: string | null) => {
        requests.push(from);
        return { chunk: [] };
      }),
    });
    const room = Object.assign(new EventEmitter(), {
      roomId: '!room:example.org',
      client,
      threadsTimelineSets: [{}, {}],
      getUnfilteredTimelineSet: () => unfiltered,
      getThreads: () => [],
      getThread: () => undefined,
      processListedThreadRoots: vi.fn(),
      fetchRoomThreads: vi.fn(() => firstPage),
    });
    const stop = relistThreadsAfterGaps(client as unknown as MatrixClient);
    const gap = () => room.emit(RoomEvent.TimelineReset, room, unfiltered, false);
    return { room, requests, gap, answer, fail, stop };
  };

  it('asks for the first page once when a gap comes while the first read waits for it', async () => {
    const { room, requests, gap, answer, stop } = setupGapRoom();
    const loading = loadRoomThreads(room as never);
    await vi.waitFor(() => expect(room.fetchRoomThreads).toHaveBeenCalledOnce());
    gap();
    answer();
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([]);
    stop();
  });

  it('reads the list after a gap that came during a first read that gave up', async () => {
    const { room, requests, gap, fail, stop } = setupGapRoom();
    const loading = loadRoomThreads(room as never);
    await vi.waitFor(() => expect(room.fetchRoomThreads).toHaveBeenCalledOnce());
    gap();
    fail(Object.assign(new Error('not served'), { httpStatus: 400 }));
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([null]);
    stop();
  });

  it('reads the list after a gap that comes while the first read pages back', async () => {
    setServerSideListSupport(true);
    const { room, requests, gap, answer, stop } = setupGapRoom();
    let nextPage!: (more: boolean) => void;
    Object.assign(room.threadsTimelineSets[0]!, {
      getLiveTimeline: () => ({ getPaginationToken: () => 'older' }),
    });
    const paginateEventTimeline = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          nextPage = resolve;
        })
    );
    Object.assign(room.client, { paginateEventTimeline });
    const loading = loadRoomThreads(room as never);
    answer();
    await vi.waitFor(() => expect(paginateEventTimeline).toHaveBeenCalledOnce());
    gap();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([null]);
    nextPage(false);
    await loading;
    stop();
  });

  it('reads the list after a gap that comes once the first read answered', async () => {
    const { room, requests, gap, answer, stop } = setupGapRoom();
    const loading = loadRoomThreads(room as never);
    answer();
    await loading;
    gap();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([null]);
    stop();
  });
});
