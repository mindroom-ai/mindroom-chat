import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Ledger lifecycle pins (mutant audit 2026-07-07):
//  1. settle GENERATION guard — a ledger settle wait armed in a previous
//     thread must not settle the next thread's ledger (mutant #4), and the
//     render-time ledger reset must land ABOVE the useVirtualizer call so
//     the FIRST post-switch render already reads scrollMargin 0 (mutants
//     #7a/#7b — PR #88's stale-scrollMargin major).
//  2. open-at-latest latch keying — the render-time key reset and the
//     stale-pending guard (mutants #11a/#11b).
//
// The quiescence module is mocked with MANUALLY RESOLVED deferreds for the
// ledger settle waits (maxWaitMs: Infinity); ordinary pagination-commit
// waits (no options) auto-resolve so the Load Older pipeline flows.
// Per-thread gate on the open chain's first await: lets a test hold a
// thread's open chain in flight (stale threadLatestOpenPending) while the
// component switches to another thread.
const threadOpenGates = new Map<string, Promise<void>>();
vi.mock('../threadOpenCacheFirst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../threadOpenCacheFirst')>();
  return {
    ...actual,
    runThreadOpenCacheFirst: async (
      opts: Parameters<typeof actual.runThreadOpenCacheFirst>[0]
    ) => {
      const gate = threadOpenGates.get(opts.threadId);
      if (gate) await gate;
      return actual.runThreadOpenCacheFirst(opts);
    },
  };
});

const settleWaits: { resolve: () => void }[] = [];
// Mutable so the dropped-correction pin can run the component's iOS
// always-drop path (the hook builder captures this function).
let mockIsIOSWebKit = false;
vi.mock('../scrollQuiescence', () => ({
  SCROLL_QUIESCENCE_IDLE_MS: 150,
  isIOSWebKitDevice: () => mockIsIOSWebKit,
  hasActiveWindowTouches: () => false,
  waitForScrollQuiescence: vi.fn(
    (_el: unknown, opts?: { maxWaitMs?: number }): Promise<void> => {
      if (opts?.maxWaitMs === Infinity) {
        return new Promise<void>((resolve) => {
          settleWaits.push({ resolve });
        });
      }
      return Promise.resolve();
    }
  ),
}));

import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
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
  threadRenderStateMock.threadEvents = events as never;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
};

const makeLedgerSettleElements = (initialScrollTop = 0) => {
  let scrollTopValue = initialScrollTop;
  const scrollWrites: number[] = [];
  const scrollListeners: EventListener[] = [];
  const scrollElement = {
    isConnected: true,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'scroll') scrollListeners.push(listener);
    }),
    removeEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
    querySelector: vi.fn(() => undefined),
    querySelectorAll: vi.fn(() => []),
    scrollHeight: 4000,
    clientHeight: 600,
    get scrollTop() {
      return scrollTopValue;
    },
    set scrollTop(value: number) {
      scrollWrites.push(value);
      scrollTopValue = value;
    },
    scrollTo: vi.fn(),
  };
  const innerElement = {
    style: {} as Record<string, string>,
    // With a positive ledger this is inside the two-viewport top guard.
    getBoundingClientRect: vi.fn(() => ({ top: -1000, bottom: 60_000 })),
  };
  const fireScroll = () => {
    scrollListeners.forEach((listener) => listener(new Event('scroll')));
  };
  return { scrollElement, innerElement, scrollWrites, fireScroll };
};

const readLedgerSettleCounts = async () => {
  const { getCacheProbeSnapshot } = await import('../cacheProbe');
  const snapshot = getCacheProbeSnapshot() as unknown as Record<string, number>;
  return {
    quiescence: snapshot.ledgerQuiescenceSettles ?? 0,
    boundary: snapshot.ledgerBoundarySettles ?? 0,
  };
};

describe('RoomTimeline ledger lifecycle', () => {
  it('a settle wait armed in a previous thread never settles the next thread ledger', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$ledger-gen-a';
    const threadB = '$ledger-gen-b';
    const a = buildThread(threadA, '$ga-', 100);
    const b = buildThread(threadB, '$gb-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);

    let anchorId = '$ga-100';
    let anchorMounted = true;
    const anchorElement = {
      getAttribute: vi.fn((name: string) => (name === 'data-message-id' ? anchorId : null)),
      getBoundingClientRect: vi.fn(() => ({ top: 10, bottom: 50 })),
    };
    const scrollElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
      querySelector: vi.fn(() => undefined),
      querySelectorAll: vi.fn(() => (anchorMounted ? [anchorElement] : [])),
      scrollHeight: 4000,
      clientHeight: 600,
      scrollTop: 0,
      scrollTo: vi.fn(),
    };
    const innerElement = { style: {} as Record<string, string> };
    matrixClientMock.paginateEventTimeline.mockImplementation(async () => false);
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

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
        await flushAsyncWork();
      });

      // Thread A: Load Older folds 100 one-liners (compact estimate 26px
      // each) into the ledger and arms a settle wait — which this mock
      // holds open, as a long-momentum ride does in production.
      const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
      await act(async () => {
        loadOlderChip.props.onClick();
        await flushAsyncWork(10);
      });
      await act(async () => {
        anchorMounted = false;
        setThreadEvents(a.prependedEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA })
        );
        await flushAsyncWork(10);
      });
      expect(innerElement.style.marginTop).toBe('-2600px');
      expect(settleWaits.length).toBe(1);
      const staleWait = settleWaits[0];

      // Switch to thread B while A's settle wait is still pending. The
      // render-time reset must zero the ledger for B.
      roomTimelineVirtualizerState.optionsHistory.length = 0;
      await act(async () => {
        anchorId = '$gb-100';
        anchorMounted = true;
        setThreadEvents(b.initialEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadB })
        );
        await flushAsyncWork(10);
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollElement.scrollTop).toBe(0);
      // Mutant 7b: the reset must run ABOVE the useVirtualizer call — a
      // ref-only reset schedules no re-render, so if it ran below, the
      // FIRST post-switch render would hand the virtualizer the stale
      // -2600 scrollMargin and only heal on some later incidental render.
      // `lastOptions` cannot see this (later renders overwrite it); the
      // history can.
      expect(roomTimelineVirtualizerState.optionsHistory.length).toBeGreaterThan(0);
      // toBeCloseTo: the option is computed as -px, which is -0 at zero.
      expect(roomTimelineVirtualizerState.optionsHistory[0]?.scrollMargin).toBeCloseTo(0);

      // Thread B accrues its own ledger: 5 prepended one-liners = 130px.
      const loadOlderChipB = getClickableByText(renderer!, 'Load Older Messages');
      await act(async () => {
        loadOlderChipB.props.onClick();
        await flushAsyncWork(10);
      });
      await act(async () => {
        anchorMounted = false;
        setThreadEvents(b.prependedEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadB })
        );
        await flushAsyncWork(10);
      });
      expect(innerElement.style.marginTop).toBe('-130px');
      expect(settleWaits.length).toBe(2);

      // THE PIN: the STALE wait (generation A) resolves first — in
      // production A's scroll element disconnected, so its quiescence
      // fires long before B is quiet. It must NOT settle B's ledger.
      await act(async () => {
        staleWait.resolve();
        await flushAsyncWork(5);
      });
      expect(innerElement.style.marginTop).toBe('-130px');
      expect(scrollElement.scrollTop).toBe(0);

      // Healthy path: B's own wait settles B's ledger exactly.
      await act(async () => {
        settleWaits[1].resolve();
        await flushAsyncWork(5);
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollElement.scrollTop).toBe(130);
    } finally {
      renderer?.unmount();
    }
  });

  it('a dropped correction forces its own commit: the margin syncs with no other render trigger', async () => {
    // Mutant audit 2026-07-07, survivor 8: react-virtual SKIPS rerenders
    // when the visible range is unchanged and tiles are absolutely
    // positioned, so a dropped correction only materializes if the drop
    // handler forces a commit (setLedgerCommitTick). Without it the
    // ledger ref grows but margin/tiles never move — the paired ±140px
    // flash class. The pin invokes the component-installed
    // shouldAdjustScrollPositionOnItemSizeChange hook directly, outside
    // any React commit, exactly as virtual-core's ResizeObserver does.
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$ledger-tick-a';
    const a = buildThread(threadA, '$tick-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadA ? (a.model as never) : null);
    setThreadEvents(a.initialEvents);
    const scrollElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
      querySelector: vi.fn(() => undefined),
      querySelectorAll: vi.fn(() => []),
      scrollHeight: 4000,
      clientHeight: 600,
      scrollTop: 0,
      scrollTo: vi.fn(),
    };
    const innerElement = { style: {} as Record<string, string> };
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

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
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;
      expect(typeof hook).toBe('function');

      await act(async () => {
        // A row fully above the viewport grew by 64px mid-scroll on iOS:
        // the correction must be DROPPED (return false) and ledgered.
        expect(
          hook!({ end: 100 }, 64, { scrollOffset: 5000, scrollDirection: 'forward' })
        ).toBe(false);
        // Desktop backward remeasurements take the same component-level
        // ledger path, while forward/quiet desktop corrections stay owned
        // by virtual-core.
        mockIsIOSWebKit = false;
        expect(
          hook!({ end: 100 }, 32, { scrollOffset: 5000, scrollDirection: 'backward' })
        ).toBe(false);
        expect(
          hook!({ end: 100 }, 16, { scrollOffset: 5000, scrollDirection: 'forward' })
        ).toBe(true);
        await flushAsyncWork(3);
      });
      // The tick-forced commit synced the margin — with no scroll event,
      // no prop change, and no other state update anywhere.
      expect(innerElement.style.marginTop).toBe('-96px');
      expect(scrollElement.scrollTop).toBe(0);
      expect(scrollElement.scrollTo).not.toHaveBeenCalled();
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('tags a boundary settlement once and leaves the pending quiescence waiter as a no-op', async () => {
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$ledger-boundary-cause';
    const thread = buildThread(threadId, '$boundary-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    const { scrollElement, innerElement, scrollWrites, fireScroll } =
      makeLedgerSettleElements(1023);
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const waitsBefore = settleWaits.length;
    const countsBefore = await readLedgerSettleCounts();
    let renderer: ReturnType<typeof create> | undefined;

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
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;
      await act(async () => {
        expect(
          hook!({ end: 100 }, 64, { scrollOffset: 5000, scrollDirection: 'forward' })
        ).toBe(false);
        await flushAsyncWork(3);
      });
      expect(innerElement.style.marginTop).toBe('-64px');
      expect(settleWaits).toHaveLength(waitsBefore + 1);

      await act(async () => {
        fireScroll();
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([1087]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });

      await act(async () => {
        settleWaits[waitsBefore].resolve();
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([1087]);
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('tags an ordinary ledger settlement as quiescence', async () => {
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$ledger-quiescence-cause';
    const thread = buildThread(threadId, '$quiescence-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    const { scrollElement, innerElement, scrollWrites } = makeLedgerSettleElements();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const waitsBefore = settleWaits.length;
    const countsBefore = await readLedgerSettleCounts();
    let renderer: ReturnType<typeof create> | undefined;

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
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;
      await act(async () => {
        expect(
          hook!({ end: 100 }, 64, { scrollOffset: 5000, scrollDirection: 'forward' })
        ).toBe(false);
        await flushAsyncWork(3);
      });
      expect(innerElement.style.marginTop).toBe('-64px');
      expect(settleWaits).toHaveLength(waitsBefore + 1);

      await act(async () => {
        settleWaits[waitsBefore].resolve();
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([64]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence + 1,
        boundary: countsBefore.boundary,
      });
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  // The open-at-latest pin is observable through the scrollToBottom dom
  // util, which the shared harness mocks module-wide.
  const getScrollToBottomMock = async () => {
    const domUtils = await import('../../../utils/dom');
    return vi.mocked(domUtils.scrollToBottom);
  };

  const makePinHarnessElements = () => {
    const scrollElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
      querySelector: vi.fn(() => undefined),
      querySelectorAll: vi.fn(() => []),
      scrollHeight: 4000,
      clientHeight: 600,
      offsetHeight: 600,
      scrollTop: 0,
      scrollTo: vi.fn(),
    };
    const innerElement = { style: {} as Record<string, string> };
    return { scrollElement, innerElement };
  };

  it('render-time latch keying: a stale open-at-latest latch never pins the next thread', async () => {
    // Pins mutant #11b (latch reset removed from the key-change branch):
    // thread A legitimately latched open-at-latest; switching to thread B
    // (opened to a FOCUSED EVENT, so B must NOT pin) must drop the latch
    // in the SAME render — B never gets bottom-pinned.
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$latch-key-a';
    const threadB = '$latch-key-b';
    const a = buildThread(threadA, '$ka-', 0);
    const b = buildThread(threadB, '$kb-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);
    const { scrollElement, innerElement } = makePinHarnessElements();
    const scrollToBottomMock = await getScrollToBottomMock();
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
      renderer?.unmount();
    }
  });

  it('switch render with a stale pending flag must not re-latch the new thread', async () => {
    // Pins mutant #11a (the `else` on the stale-pending guard): switching
    // away while A's open chain is still in flight leaves
    // threadLatestOpenPending stale-true on the switch render (A's
    // finally skips the clear once threadIdRef moved on). That stale flag
    // must not latch open-at-latest for B.
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$latch-pend-a';
    const threadB = '$latch-pend-b';
    const a = buildThread(threadA, '$pa-', 0);
    const b = buildThread(threadB, '$pb-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);
    const { scrollElement, innerElement } = makePinHarnessElements();
    const scrollToBottomMock = await getScrollToBottomMock();
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
      renderer?.unmount();
    }
  });
});
