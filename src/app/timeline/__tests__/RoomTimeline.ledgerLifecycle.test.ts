import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

// Per-thread gate on the open chain's first await: lets a test hold a
// thread's open chain in flight (stale threadLatestOpenPending) while the
// component switches to another thread.
const threadOpenGates = new Map<string, Promise<void>>();
const afterThreadOpenCacheFirst = new Map<string, (requestLatestPin: () => void) => void>();
vi.mock('../../threads/open/threadOpenCacheFirst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../threads/open/threadOpenCacheFirst')>();
  return {
    ...actual,
    runThreadOpenCacheFirst: async (opts: Parameters<typeof actual.runThreadOpenCacheFirst>[0]) => {
      const gate = threadOpenGates.get(opts.threadId);
      if (gate) await gate;
      const result = await actual.runThreadOpenCacheFirst(opts);
      afterThreadOpenCacheFirst.get(opts.threadId)?.(opts.pinThreadToBottomOnOpen);
      return result;
    },
  };
});

import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  scrollType,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';

type MockEvent = ReturnType<typeof makeEvent>;

const buildThread = (rootId: string, replyPrefix: string, replyCount: number) => {
  const rootEvent = makeEvent(rootId, { isThreadRoot: true, ts: 0 });
  const makeReply = (index: number) =>
    makeEvent(`${replyPrefix}${index}`, { threadRootId: rootId, ts: index + 1 });
  const initialEvents = [
    rootEvent,
    ...Array.from({ length: 200 }, (_v, index) => makeReply(index + 100)),
  ];
  const prependedEvents = [
    rootEvent,
    ...Array.from({ length: replyCount }, (_v, index) => makeReply(index)),
    ...initialEvents.slice(1),
  ];
  const timeline = makeTimeline(initialEvents, { backwardToken: `tok-back-${rootId}` });
  const timelineSet = {
    getLiveTimeline: () => timeline,
    getTimelineForEvent: () => undefined,
  };
  const model = {
    rootEvent,
    events: initialEvents,
    getUnfilteredTimelineSet: () => timelineSet,
  };
  return { rootEvent, initialEvents, prependedEvents, model };
};

const setThreadEvents = (events: MockEvent[]) => {
  threadRenderStateMock.threadEvents = events;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline thread opening pin lifecycle', () => {
  // Thread open-at-latest pins route through virtualizer.scrollToEnd().

  const makePinHarnessElements = (initialScrollTop = 0) => {
    let scrollTop = initialScrollTop;
    const listeners = new Map<string, Set<EventListener>>();
    const scrollElement = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        const eventListeners = listeners.get(type) ?? new Set<EventListener>();
        eventListeners.add(listener);
        listeners.set(type, eventListeners);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      }),
      dispatch: (type: string) => {
        listeners.get(type)?.forEach((listener) => listener(new Event(type)));
      },
      setNativeScrollTop: (nextScrollTop: number) => {
        scrollTop = nextScrollTop;
      },
      getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
      querySelector: vi.fn(() => undefined),
      querySelectorAll: vi.fn(() => []),
      scrollHeight: 4000,
      clientHeight: 600,
      offsetHeight: 600,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(nextScrollTop: number) {
        scrollTop = nextScrollTop;
      },
      scrollTo: vi.fn(),
    };
    const innerElement = {
      style: {} as Record<string, string>,
      getBoundingClientRect: () => ({ top: 0 }),
    };
    return { scrollElement, innerElement };
  };

  it('keeps the first user wheel movement after focus and session opening pins queue', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('../../event-store/cache/db');
    const threadId = '$opening-input-ownership';
    const thread = buildThread(threadId, '$opening-input-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? thread.model : null);
    setThreadEvents(thread.initialEvents);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [],
      hasMoreBefore: false,
      rootEvent: {
        content: { body: 'root', msgtype: 'm.text' },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    let releaseOpen!: () => void;
    threadOpenGates.set(
      threadId,
      new Promise<void>((resolve) => {
        releaseOpen = resolve;
      })
    );
    const { scrollElement, innerElement } = makePinHarnessElements(3400);
    const scrollToBottomMock = roomTimelineVirtualizerState.scrollToEndMock;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    let sessionOpeningPinQueued = false;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }), {
          createNodeMock: (element) =>
            element.type === scrollType
              ? scrollElement
              : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                ? innerElement
                : null,
        });
        await flushAsyncWork(5);
      });

      // The focus producer has already pinned the opening band while the
      // cache-first session producer remains parked at its controlled await.
      expect(scrollToBottomMock.mock.calls.length).toBeGreaterThan(0);
      scrollToBottomMock.mockClear();
      afterThreadOpenCacheFirst.set(threadId, (requestLatestPin) => {
        requestLatestPin();
        sessionOpeningPinQueued = true;
        scrollElement.dispatch('wheel');
        // Model the browser's trusted default movement without recording an
        // application scroll write. Consumers run only after this callback.
        scrollElement.setNativeScrollTop(3320);
      });

      await act(async () => {
        releaseOpen();
        await flushAsyncWork(10);
      });

      expect(sessionOpeningPinQueued).toBe(true);
      expect(scrollElement.scrollTop).toBe(3320);
      expect(scrollToBottomMock.mock.calls).toEqual([]);

      // A late hydration-shaped band must remain reader-owned after the
      // session open has completed and after later animation frames.
      await act(async () => {
        setThreadEvents([
          ...thread.initialEvents,
          makeEvent('$opening-input-late-band', { threadRootId: threadId, ts: 999 }),
        ]);
        renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId }));
        await flushAsyncWork(5);
      });
      expect(scrollElement.scrollTop).toBe(3320);
      expect(scrollToBottomMock.mock.calls).toEqual([]);
    } finally {
      releaseOpen();
      afterThreadOpenCacheFirst.delete(threadId);
      threadOpenGates.delete(threadId);
      act(() => {
        renderer?.unmount();
      });
    }
  });

  it('render-time latch keying: a stale open-at-latest latch never pins the next thread', async () => {
    // Pins mutant #11b (latch reset removed from the key-change branch):
    // thread A legitimately latched open-at-latest; switching to thread B
    // (opened to a FOCUSED EVENT, so B must NOT pin) must drop the latch
    // in the SAME render — B never gets bottom-pinned.
    const { RoomTimeline } = await import('../RoomTimeline');
    const threadA = '$latch-key-a';
    const threadB = '$latch-key-b';
    const a = buildThread(threadA, '$ka-', 0);
    const b = buildThread(threadB, '$kb-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? a.model : eventId === threadB ? b.model : null;
    setThreadEvents(a.initialEvents);
    const { scrollElement, innerElement } = makePinHarnessElements();
    const scrollToBottomMock = roomTimelineVirtualizerState.scrollToEndMock;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      // Open A at latest and let the whole open chain complete: pending
      // clears, the latch stays TRUE (it must survive for hydration
      // bands), and the pin fired for A (sanity).
      scrollToBottomMock.mockClear();
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
          {
            createNodeMock: (element) =>
              element.type === scrollType
                ? scrollElement
                : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                  ? innerElement
                  : null,
          }
        );
        await flushAsyncWork(10);
      });
      expect(scrollToBottomMock.mock.calls.length).toBeGreaterThan(0);

      // Switch to B, opened to a focused event: pending stays false and
      // the latch must reset AT RENDER TIME — no commit of B may see A's
      // latch, so the bottom pin must never fire for B.
      scrollToBottomMock.mockClear();
      await act(async () => {
        setThreadEvents(b.initialEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$kb-150',
          })
        );
        await flushAsyncWork(10);
      });
      // Drive a hydration-band-shaped commit (the pin effect keys on
      // threadEventsLength): still no pin.
      await act(async () => {
        setThreadEvents([
          ...b.initialEvents,
          makeEvent('$kb-band', { threadRootId: threadB, ts: 999 }),
        ]);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$kb-150',
          })
        );
        await flushAsyncWork(5);
      });
      expect(scrollToBottomMock.mock.calls).toEqual([]);
    } finally {
      act(() => {
        renderer?.unmount();
      });
    }
  });

  it('switch render with a stale pending flag must not re-latch the new thread', async () => {
    // Pins mutant #11a (the `else` on the stale-pending guard): switching
    // away while A's open chain is still in flight leaves
    // threadLatestOpenPending stale-true on the switch render (A's
    // finally skips the clear once threadIdRef moved on). That stale flag
    // must not latch open-at-latest for B.
    const { RoomTimeline } = await import('../RoomTimeline');
    const threadA = '$latch-pend-a';
    const threadB = '$latch-pend-b';
    const a = buildThread(threadA, '$pa-', 0);
    const b = buildThread(threadB, '$pb-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? a.model : eventId === threadB ? b.model : null;
    setThreadEvents(a.initialEvents);
    const { scrollElement, innerElement } = makePinHarnessElements();
    const scrollToBottomMock = roomTimelineVirtualizerState.scrollToEndMock;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    // Hold A's open chain at its first await: pending stays true while
    // the test switches to B, and A's finally (which would clear it) only
    // runs after threadIdRef has moved on — the stale-flag state greptile
    // flagged on PR #83.
    let releaseThreadAOpen!: () => void;
    threadOpenGates.set(
      threadA,
      new Promise<void>((resolve) => {
        releaseThreadAOpen = resolve;
      })
    );
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
          {
            createNodeMock: (element) =>
              element.type === scrollType
                ? scrollElement
                : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                  ? innerElement
                  : null,
          }
        );
        await flushAsyncWork(5);
      });

      // Switch to B (focused-event open) while A's chain is parked: the
      // switch render sees the stale pending flag.
      await act(async () => {
        setThreadEvents(b.initialEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$pb-150',
          })
        );
        await flushAsyncWork(10);
      });
      // Release A's chain; its finally must skip the pending clear
      // (threadIdRef is B) — the flag was already cleared by B's effect.
      await act(async () => {
        releaseThreadAOpen();
        await flushAsyncWork(10);
      });

      // Pending has been cleared by B's own open effect by now. If the
      // stale flag re-latched on the switch render, the pin fires on
      // every later commit; latch-free it must stay silent.
      scrollToBottomMock.mockClear();
      await act(async () => {
        setThreadEvents([
          ...b.initialEvents,
          makeEvent('$pb-band', { threadRootId: threadB, ts: 999 }),
        ]);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$pb-150',
          })
        );
        await flushAsyncWork(5);
      });
      expect(scrollToBottomMock.mock.calls).toEqual([]);
    } finally {
      threadOpenGates.clear();
      act(() => {
        renderer?.unmount();
      });
    }
  });
});
