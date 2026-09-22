import React, { useEffect, useRef } from 'react';
import { createClient, Direction, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { useThreadPagination } from './useThreadPagination';
import { useThreadPrependViewport } from '../useThreadPrependViewport';
import { useThreadBackPaginationController } from '../threadBackPaginationController';
import { loadThreadCachedPaginationSnapshot, loadThreadCachedSnapshot } from '../eventRepository';
import { useThreadSession } from './useThreadSession';
import { waitForScrollQuiescence } from '../scrollQuiescence';
import type {
  ThreadOpenRuntime,
  ThreadRoute,
  ThreadPagination,
  ThreadSessionCommands,
} from './threadSessionTypes';

vi.mock('../eventRepository', async (original) => ({
  ...(await original<typeof import('../eventRepository')>()),
  loadThreadCachedPaginationSnapshot: vi.fn(),
  loadThreadCachedSnapshot: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../scrollQuiescence', () => ({ waitForScrollQuiescence: vi.fn(async () => {}) }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
type Page = Awaited<ReturnType<typeof loadThreadCachedPaginationSnapshot>>;
const page = (id: string): Page => ({
  status: 'cache-hit',
  events: [new MatrixEvent({ event_id: id })],
  cachedPage: { events: [], hasMoreBefore: true },
  hasMoreCachedBack: true,
});
const scrollRoot = {
  getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
  querySelectorAll: () => [
    {
      getAttribute: () => '$anchor',
      getBoundingClientRect: () => ({ top: 140, bottom: 180 }),
      parentElement: null,
    },
  ],
} as unknown as HTMLDivElement;

const fixture = (renderedEvents: MatrixEvent[] = []) => {
  const mx = createClient({ baseUrl: 'https://example.org' });
  vi.spyOn(mx, 'getEventTimeline').mockImplementation(() => new Promise(() => {}));
  const room = new Room('!room:example.org', mx, '@user:example.org');
  const otherRoom = new Room('!other:example.org', mx, '@user:example.org');
  const order: string[] = [];
  const capture = vi.fn(() => {
    order.push('capture');
  });
  const clearCapture = vi.fn(() => {
    order.push('clear');
  });
  const persist = vi.fn(() => {
    order.push('persist');
  });
  const runtime: ThreadOpenRuntime = {
    mx,
    room,
    sessionId: 'session',
    beginCacheWrite: () => persist,
    reconcile: vi.fn(),
    seed: { waitForExistingOrQueued: () => undefined },
    render: {
      reset: vi.fn(),
      append: vi.fn(() => {
        order.push('append');
      }),
      invalidateTimeline: vi.fn(() => {
        order.push('invalidate');
      }),
    },
    viewport: { resetForOpen: vi.fn(), resetAfterLeave: vi.fn(), requestLatestPin: vi.fn() },
  };
  const thread = {
    events: [new MatrixEvent({ event_id: '$root' })],
    rootEvent: undefined,
    getUnfilteredTimelineSet: () => room.getUnfilteredTimelineSet(),
  } as unknown as Thread;
  room.getLiveTimeline().setPaginationToken('older', Direction.Backward);
  room.getLiveTimeline().setPaginationToken('newer', Direction.Forward);
  let withThread = false;
  let visible = true;
  const paginate = vi.spyOn(mx, 'paginateEventTimeline');
  let result: ThreadPagination & {
    paginateBack(): Promise<void>;
    pending: boolean;
    anchor?: string;
    commands: ThreadSessionCommands;
  };
  let renderer: ReactTestRenderer;
  const Harness = ({ roomId, threadId, eventId }: ThreadRoute) => {
    const currentRoom = roomId === room.roomId ? room : otherRoom;
    const session = useThreadSession({ roomId, threadId, eventId });
    const back = useThreadBackPaginationController();
    const { pagination, bindRuntime } = useThreadPagination(session.commands, {
      roomId,
      threadId,
      eventId,
    });
    const scrollRef = useRef(scrollRoot);
    scrollRef.current = visible ? scrollRoot : { ...scrollRoot, querySelectorAll: () => [] };
    const eventIndex = useRef(new Map([['$anchor', 0]]));
    const viewport = useThreadPrependViewport({
      controller: back,
      scrollRef,
      eventIndex,
      capture,
      clearCapture,
    });
    const { isPending } = pagination;
    useEffect(() => {
      if (!isPending('backward')) back.reset();
      return session.commands.startOpen({ ...runtime, room: currentRoom });
    }, [roomId, threadId, eventId, session.commands, back, currentRoom, isPending]);
    bindRuntime({
      mx,
      room: currentRoom,
      sessionId: 'session',
      beginThreadCacheWrite: runtime.beginCacheWrite,
      thread: withThread ? thread : undefined,
      threadEvents: renderedEvents,
      threadHasMoreCachedBack: true,
      viewport,
    });
    result = {
      ...pagination,
      commands: session.commands,
      pending: pagination.snapshot.backward === 'pending',
      get anchor() {
        return back.getPendingAnchorEventId();
      },
    };
    return null;
  };
  const rerender = (threadId: string, roomId = room.roomId, eventId?: string) =>
    act(() => {
      const element = <Harness roomId={roomId} threadId={threadId} eventId={eventId} />;
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
  rerender('$a');
  return {
    current: () => result,
    rerender,
    runtime,
    room,
    thread,
    order,
    capture,
    clearCapture,
    paginate,
    useNetwork: () => {
      withThread = true;
      rerender('$a');
    },
    hideRows: () => {
      visible = false;
      rerender('$a');
    },
    unmount: () => act(() => renderer.unmount()),
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadThreadCachedPaginationSnapshot).mockReset();
  vi.mocked(waitForScrollQuiescence).mockResolvedValue(undefined);
  vi.mocked(loadThreadCachedSnapshot).mockImplementation(() => new Promise(() => {}));
});
describe('thread pagination request ownership', () => {
  it.each(['older', 'exhausted', 'repeated-cursor'] as const)(
    'crosses server pages already present in the rendered window until %s',
    async (ending) => {
      const reply = (id: string, ts: number) =>
        new MatrixEvent({
          event_id: id,
          origin_server_ts: ts,
          content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$a' } },
        });
      const earliest = reply('$rendered-earliest', 100);
      const overlap = reply('$already-rendered', 200);
      const older = reply('$unseen-older', 50);
      const f = fixture([earliest, overlap]);
      f.useNetwork();
      f.paginate
        .mockImplementationOnce(async () => {
          f.thread.events.push(overlap);
          f.room.getLiveTimeline().setPaginationToken('next-page', Direction.Backward);
          return true;
        })
        .mockImplementationOnce(async () => {
          if (ending === 'older') f.thread.events.push(older);
          f.room
            .getLiveTimeline()
            .setPaginationToken(ending === 'exhausted' ? null : 'next-page', Direction.Backward);
          return ending !== 'exhausted';
        });
      try {
        await act(async () => {
          await f.current().paginateBack();
        });
        expect(f.paginate).toHaveBeenCalledTimes(2);
        expect(loadThreadCachedPaginationSnapshot).not.toHaveBeenCalled();
        expect(f.runtime.render.invalidateTimeline).toHaveBeenCalledTimes(1);
        expect(f.current().snapshot.backward).toBe('idle');
        if (ending === 'older') expect(f.thread.events).toContain(older);
      } finally {
        f.unmount();
      }
    }
  );

  it('keeps cache-only history retryable after a storage read failure', async () => {
    const cached = page('$retried-cache');
    vi.mocked(loadThreadCachedPaginationSnapshot)
      .mockRejectedValueOnce(new DOMException('Cache closed', 'InvalidStateError'))
      .mockResolvedValueOnce(cached);
    const f = fixture();
    f.useNetwork();
    f.room.getLiveTimeline().setPaginationToken(null, Direction.Backward);
    const exhausted = vi.spyOn(f.current().commands, 'markBackwardExhausted');
    try {
      await act(async () => {
        await f.current().paginateBack();
      });
      expect(exhausted).not.toHaveBeenCalled();
      expect(f.current().snapshot.backward).toBe('idle');
      await act(async () => {
        await f.current().paginateBack();
      });
      expect(f.runtime.render.append).toHaveBeenCalledWith('$a', cached.events);
    } finally {
      f.unmount();
    }
  });

  it('uses an available server cursor without waiting for a blocked cache read', async () => {
    vi.mocked(loadThreadCachedPaginationSnapshot).mockReturnValueOnce(new Promise(() => {}));
    const f = fixture();
    f.useNetwork();
    const reply = new MatrixEvent({ event_id: '$network-page' });
    f.paginate.mockImplementation(async () => {
      f.thread.events.push(reply);
      return true;
    });
    try {
      let completed = false;
      await act(async () => {
        void f
          .current()
          .paginateBack()
          .then(() => {
            completed = true;
          });
      });
      expect(f.thread.events).toContain(reply);
      expect(completed).toBe(true);
      expect(f.current().snapshot.backward).toBe('idle');
    } finally {
      f.unmount();
    }
  });

  it('loads a cached page when the server request fails', async () => {
    const cached = page('$offline-reply');
    vi.mocked(loadThreadCachedPaginationSnapshot).mockResolvedValueOnce(cached);
    const f = fixture();
    f.useNetwork();
    f.paginate.mockRejectedValueOnce(new Error('Offline'));
    try {
      await act(async () => {
        await f.current().paginateBack();
      });
      expect(f.runtime.render.append).toHaveBeenCalledWith('$a', cached.events);
      expect(f.runtime.render.invalidateTimeline).toHaveBeenCalled();
      expect(f.current().snapshot.backward).toBe('idle');
    } finally {
      f.unmount();
    }
  });

  it('old backward completion cannot release replacement pending state or clear its anchor', async () => {
    const a = deferred<Page>();
    const b = deferred<Page>();
    vi.mocked(loadThreadCachedPaginationSnapshot)
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const f = fixture();
    let requestA!: Promise<void>;
    let requestB!: Promise<void>;
    act(() => {
      requestA = f.current().paginateBack();
    });
    f.rerender('$b');
    act(() => {
      requestB = f.current().paginateBack();
    });
    const clearsBeforeOld = f.clearCapture.mock.calls.length;
    await act(async () => {
      a.resolve(page('$old'));
      await requestA;
    });
    expect(f.clearCapture).toHaveBeenCalledTimes(clearsBeforeOld);
    expect(f.current().pending).toBe(true);
    expect(f.current().isPending('backward')).toBe(true);
    expect(f.current().anchor).toBe('$anchor');
    await act(async () => {
      b.resolve(page('$new'));
      await requestB;
    });
    expect(f.current().pending).toBe(false);
    f.unmount();
  });
  it('rejects an old A page after A/B/A navigation', async () => {
    const a = deferred<Page>();
    const replacement = deferred<Page>();
    vi.mocked(loadThreadCachedPaginationSnapshot)
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(replacement.promise);
    const f = fixture();
    let request!: Promise<void>;
    act(() => {
      request = f.current().paginateBack();
    });
    f.rerender('$b');
    f.rerender('$a');
    act(() => {
      void f.current().paginateBack();
    });
    await act(async () => {
      a.resolve(page('$old'));
      await request;
    });
    expect(f.runtime.render.append).not.toHaveBeenCalled();
    f.unmount();
  });
});

// These contracts distinguish stale UI publication from already-accepted SDK/cache work.
describe('pagination boundaries and commit ordering', () => {
  it('scopes a reused thread ID to its room before any cache-token mutation', async () => {
    const oldPage = deferred<Page>();
    const nextPage = deferred<Page>();
    vi.mocked(loadThreadCachedPaginationSnapshot)
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(nextPage.promise);
    const f = fixture();
    f.useNetwork();
    f.paginate.mockRejectedValue(new Error('Offline'));
    let old!: Promise<void>;
    let next!: Promise<void>;
    await act(async () => {
      old = f.current().paginateBack();
    });
    f.rerender('$a', '!other:example.org');
    await act(async () => {
      next = f.current().paginateBack();
    });
    await act(async () => {
      oldPage.resolve({
        ...page('$old'),
        cachedPage: { events: [], hasMoreBefore: false, beforeToken: null },
      });
      await old;
    });
    expect(f.room.getLiveTimeline().getPaginationToken(Direction.Backward)).toBe('older');
    expect(f.runtime.render.append).not.toHaveBeenCalled();
    expect(f.current().snapshot.backward).toBe('pending');
    await act(async () => {
      nextPage.resolve(page('$new'));
      await next;
    });
    expect(f.current().snapshot.backward).toBe('idle');
    f.unmount();
  });
  it('keeps same-thread pagination and its capture across event-target-only opens', async () => {
    const cached = deferred<Page>();
    vi.mocked(loadThreadCachedPaginationSnapshot).mockReturnValueOnce(cached.promise);
    const f = fixture();
    let request!: Promise<void>;
    act(() => {
      request = f.current().paginateBack();
    });
    const lease = f.current().commands.captureLease()!;
    f.rerender('$a', f.room.roomId, '$target');
    expect(f.current().commands.isCurrent(lease)).toBe(true);
    expect(f.current().snapshot.backward).toBe('pending');
    expect(f.current().anchor).toBe('$anchor');
    const cachedPage = page('$cached');
    await act(async () => {
      cached.resolve(cachedPage);
      await request;
    });
    expect(f.runtime.render.append).toHaveBeenCalledWith('$a', cachedPage.events);
    expect(vi.mocked(f.runtime.render.append).mock.calls[0][1][0]).toBe(cachedPage.events[0]);
    expect(f.current().snapshot.backward).toBe('idle');
    f.unmount();
  });
  it('rejects duplicate backward calls synchronously without clearing the first capture', async () => {
    const cached = deferred<Page>();
    vi.mocked(loadThreadCachedPaginationSnapshot).mockReturnValueOnce(cached.promise);
    const f = fixture();
    let first!: Promise<void>;
    act(() => {
      first = f.current().paginateBack();
    });
    const captureCount = f.capture.mock.calls.length;
    const clearCount = f.clearCapture.mock.calls.length;
    await act(async () => {
      await f.current().paginateBack();
    });
    expect(loadThreadCachedPaginationSnapshot).toHaveBeenCalledTimes(1);
    expect(f.capture).toHaveBeenCalledTimes(captureCount);
    expect(f.clearCapture).toHaveBeenCalledTimes(clearCount);
    expect(f.current().isPending('backward')).toBe(true);
    await act(async () => {
      cached.resolve(page('$cached'));
      await first;
    });
    f.unmount();
  });
  it('does not publish or recapture after unmount while quiescent', async () => {
    const quiet = deferred<void>();
    vi.mocked(loadThreadCachedPaginationSnapshot).mockResolvedValue(page('$cached'));
    vi.mocked(waitForScrollQuiescence).mockReturnValue(quiet.promise);
    const f = fixture();
    let request!: Promise<void>;
    await act(async () => {
      request = f.current().paginateBack();
    });
    expect(waitForScrollQuiescence).toHaveBeenCalledTimes(1);
    f.unmount();
    const clears = f.clearCapture.mock.calls.length;
    await act(async () => {
      quiet.resolve();
      await request;
    });
    expect(f.runtime.render.append).not.toHaveBeenCalled();
    expect(f.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect(f.clearCapture).toHaveBeenCalledTimes(clears);
    expect(f.current().isPending('backward')).toBe(false);
  });
  it('keeps replacement backward state when old quiescence resolves', async () => {
    const quiet = deferred<void>();
    const next = deferred<Page>();
    vi.mocked(loadThreadCachedPaginationSnapshot)
      .mockResolvedValueOnce(page('$old'))
      .mockReturnValueOnce(next.promise);
    vi.mocked(waitForScrollQuiescence).mockReturnValueOnce(quiet.promise);
    const f = fixture();
    let old!: Promise<void>;
    let replacement!: Promise<void>;
    await act(async () => {
      old = f.current().paginateBack();
    });
    f.rerender('$b');
    act(() => {
      replacement = f.current().paginateBack();
    });
    const clears = f.clearCapture.mock.calls.length;
    await act(async () => {
      quiet.resolve();
      await old;
    });
    expect(f.current().snapshot.backward).toBe('pending');
    expect(f.current().anchor).toBe('$anchor');
    expect(f.clearCapture).toHaveBeenCalledTimes(clears);
    expect(f.runtime.render.append).not.toHaveBeenCalled();
    await act(async () => {
      next.resolve(page('$new'));
      await replacement;
    });
    f.unmount();
  });
  it('old forward completion preserves SDK persistence but cannot release or commit replacement work', async () => {
    const oldPage = deferred<boolean>();
    const nextPage = deferred<boolean>();
    const f = fixture();
    f.useNetwork();
    f.paginate.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(nextPage.promise);
    let old!: Promise<void>;
    let next!: Promise<void>;
    act(() => {
      old = f.current().paginateFront();
    });
    f.rerender('$b');
    act(() => {
      next = f.current().paginateFront();
    });
    await act(async () => {
      oldPage.resolve(true);
      await old;
    });
    expect(f.current().snapshot.forward).toBe('pending');
    expect(f.current().isPending('forward')).toBe(true);
    expect(f.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
    expect(f.runtime.beginCacheWrite()).toHaveBeenCalledWith(
      '$a',
      f.thread.events,
      f.thread.rootEvent,
      undefined,
      false
    );
    await act(async () => {
      nextPage.resolve(true);
      await next;
    });
    expect(f.current().snapshot.forward).toBe('idle');
    expect(f.runtime.render.invalidateTimeline).toHaveBeenCalledTimes(1);
    f.unmount();
  });
  it('preserves a stale backward network result for persistence without UI publication', async () => {
    vi.mocked(loadThreadCachedPaginationSnapshot).mockResolvedValue({ status: 'cache-miss' });
    const network = deferred<boolean>();
    const f = fixture();
    f.useNetwork();
    f.paginate.mockReturnValue(network.promise);
    let request!: Promise<void>;
    await act(async () => {
      request = f.current().paginateBack();
    });
    expect(f.paginate).toHaveBeenCalledTimes(1);
    f.rerender('$b');
    const delivered = new MatrixEvent({ event_id: '$delivered' });
    await act(async () => {
      f.thread.events.push(delivered);
      network.resolve(true);
      await request;
    });
    expect(f.thread.events).toContain(delivered);
    expect(f.runtime.beginCacheWrite()).toHaveBeenCalledWith(
      '$a',
      f.thread.events,
      f.thread.rootEvent,
      'older'
    );
    expect(f.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
    expect(waitForScrollQuiescence).not.toHaveBeenCalled();
    f.unmount();
  });
  it('cache commit waits for quiescence, recaptures, then appends the exact cached events', async () => {
    const quiet = deferred<void>();
    const cached = page('$cached');
    vi.mocked(loadThreadCachedPaginationSnapshot).mockResolvedValue(cached);
    const f = fixture();
    f.order.length = 0;
    vi.mocked(waitForScrollQuiescence).mockImplementation(() => {
      f.order.push('wait');
      return quiet.promise;
    });
    let request!: Promise<void>;
    await act(async () => {
      request = f.current().paginateBack();
    });
    expect(f.order).toEqual(['clear', 'capture', 'wait']);
    await act(async () => {
      quiet.resolve();
      await request;
    });
    expect(f.order).toEqual(['clear', 'capture', 'wait', 'capture', 'append', 'invalidate']);
    expect(vi.mocked(f.runtime.render.append).mock.calls[0][1]).toBe(cached.events);
    expect(f.runtime.beginCacheWrite()).not.toHaveBeenCalled();
    expect(f.current().anchor).toBe('$anchor');
    f.unmount();
  });
  it.each(['cache', 'network'] as const)(
    '%s with no anchor uses six bounded recaptures and its distinct commit policy',
    async (source) => {
      vi.useFakeTimers();
      vi.mocked(loadThreadCachedPaginationSnapshot).mockResolvedValue(
        source === 'cache' ? page('$cached') : { status: 'cache-miss' }
      );
      const f = fixture();
      if (source === 'network') f.useNetwork();
      f.hideRows();
      f.paginate.mockImplementation(async () => {
        f.order.push('sdk');
        return true;
      });
      vi.mocked(waitForScrollQuiescence).mockImplementation(async () => {
        f.order.push('wait');
      });
      let request!: Promise<void>;
      let finished = false;
      await act(async () => {
        request = f
          .current()
          .paginateBack()
          .then(() => {
            finished = true;
          });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299);
      });
      expect(finished).toBe(false);
      expect(f.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await request;
      });
      expect(finished).toBe(true);
      expect(f.current().anchor).toBeUndefined();
      expect(f.current().snapshot.backward).toBe('idle');
      if (source === 'cache') {
        expect(f.runtime.render.append).not.toHaveBeenCalled();
        expect(f.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
        expect(f.runtime.beginCacheWrite()).not.toHaveBeenCalled();
        // Begin, each of six failed recaptures, and failed finish clear their own ledger capture.
        expect(f.clearCapture).toHaveBeenCalledTimes(8);
      } else {
        expect(f.order.indexOf('sdk')).toBeLessThan(f.order.indexOf('persist'));
        expect(f.order.indexOf('persist')).toBeLessThan(f.order.indexOf('wait'));
        expect(f.order.indexOf('wait')).toBeLessThan(f.order.indexOf('invalidate'));
        expect(f.runtime.render.invalidateTimeline).toHaveBeenCalledTimes(1);
        expect(f.runtime.render.append).not.toHaveBeenCalled();
        expect(f.clearCapture).toHaveBeenCalledTimes(8);
      }
      f.unmount();
    }
  );
});
