// @vitest-environment jsdom
import { useLayoutEffect, useReducer } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { VirtualItem } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { LiveReplyStore } from '../messages/live/liveReplyStore';
import { isDisclosureRevealActive } from '../ui/disclosureReveal';
import { READER_INTENT_EVENTS } from './roomTimelineScroll';
import {
  computeHeldEndSpacer,
  useHeldRowsLayout,
  useTimelineLiveEnd,
  type HeldRowsLayout,
  type HeldRowsLayoutLedger,
} from './timelineLiveEnd';

vi.mock('../ui/disclosureReveal', () => ({
  isDisclosureRevealActive: vi.fn(() => false),
}));

const ROOM = '!room:example';

const makeBox = (top: number, bottom: number) =>
  ({ getBoundingClientRect: () => ({ top, bottom }) }) as unknown as HTMLElement;

const stubPadding = (paddingTop: string, paddingBottom: string) =>
  vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
    paddingTop,
    paddingBottom,
  } as unknown as CSSStyleDeclaration);

const makeVirtualItem = (index: number, end: number): VirtualItem => ({
  index,
  key: index,
  start: index * 100,
  size: end - index * 100,
  end,
  lane: 0,
});

const ingestLiveFrame = (store: LiveReplyStore, seq: number, roomId = ROOM) => {
  store.ingest(
    roomId,
    '@agent:example',
    {
      reply: '$reply',
      sid: '1761858000123-0a1b2c3d',
      seq,
      snapshot: {
        md: 'x'.repeat(seq + 1),
        reasoning: '',
        tools: [],
        status: 'streaming',
        activity: '',
        segments: [],
      },
    },
    Date.now()
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(isDisclosureRevealActive).mockReturnValue(false);
});

describe('computeHeldEndSpacer', () => {
  it('returns 0 when growth is non-positive or inputs are non-finite', () => {
    expect(computeHeldEndSpacer(undefined, 500, null, null, true)).toBe(0);
    expect(computeHeldEndSpacer(Number.NaN, 500, null, null, true)).toBe(0);
    expect(computeHeldEndSpacer(500, 500, null, null, true)).toBe(0);
    expect(computeHeldEndSpacer(420, 500, null, null, true)).toBe(0);
  });

  it('subtracts bottom slack for startAligned layouts and caps at 0', () => {
    stubPadding('0px', '60px');
    // content bottom 800, inner bottom 540, paddingBottom 60 => 200 px slack.
    const content = makeBox(0, 800);
    const inner = makeBox(40, 540);
    expect(computeHeldEndSpacer(650, 500, inner, content, true)).toBe(0);
    expect(computeHeldEndSpacer(700, 500, inner, content, true)).toBe(0);
    expect(computeHeldEndSpacer(760, 500, inner, content, true)).toBe(60);
  });

  it('subtracts top slack for end-aligned layouts and caps at 0', () => {
    stubPadding('60px', '60px');
    // inner top 220, content top 0, paddingTop 60 => 160 px slack.
    const content = makeBox(0, 800);
    const inner = makeBox(220, 720);
    expect(computeHeldEndSpacer(640, 500, inner, content, false)).toBe(0);
    expect(computeHeldEndSpacer(700, 500, inner, content, false)).toBe(40);
  });

  it('returns raw growth when DOM geometry is unavailable', () => {
    expect(computeHeldEndSpacer(580, 500, null, null, true)).toBe(80);
  });
});

describe('useTimelineLiveEnd unified ResizeObserver and listeners', () => {
  const stubResizeObserver = () => {
    const state = {
      count: 0,
      observed: [] as Element[],
      resize: undefined as ((entries: ResizeObserverEntry[]) => void) | undefined,
    };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: ResizeObserverEntry[]) => void) {
          state.count += 1;
          state.resize = callback;
        }

        observe = (target: Element) => {
          state.observed.push(target);
        };

        disconnect = vi.fn();
      }
    );
    return state;
  };

  const createTrackedScroller = (onFollow?: () => void) => {
    const listeners = new Map<string, Set<() => void>>();
    const addCounts = new Map<string, number>();
    let top = 600;
    const events: string[] = [];
    const scroller = {
      scrollHeight: 1000,
      clientHeight: 400,
      get scrollTop() {
        return top;
      },
      set scrollTop(value: number) {
        events.push(`clamp:${value}`);
        top = value;
      },
      setScrollTopSilent(value: number) {
        top = value;
      },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        addCounts.set(type, (addCounts.get(type) ?? 0) + 1);
        const set = listeners.get(type) ?? new Set<() => void>();
        set.add(listener);
        listeners.set(type, set);
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      }),
      scrollTo: vi.fn(({ top: nextTop }: { top: number }) => {
        events.push(`follow:${nextTop}`);
        top = nextTop;
        onFollow?.();
      }),
      dispatch: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
    };
    return { scroller, events, addCounts };
  };

  it('runs streaming-growth follow before end clamp inside one shared ResizeObserver', () => {
    const ro = stubResizeObserver();

    let pending = 0;
    const { scroller, events } = createTrackedScroller(() => {
      pending = 62;
    });
    const content = {} as HTMLElement;
    const probe = {} as HTMLElement;
    const liveReplies = new LiveReplyStore();
    const atLiveEndRef = { current: true };

    function Harness() {
      useTimelineLiveEnd({
        scrollElement: scroller as unknown as HTMLElement,
        contentRef: { current: content },
        footerProbeRef: { current: probe },
        isViewportAtBottomNow: () => isScrollNearBottom(scroller),
        atLiveEndRef,
        liveReplies,
        roomId: ROOM,
        pendingListShrinkPx: () => pending,
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Harness />);
    });
    expect(ro.count).toBe(1);
    expect(ro.observed).toEqual([content, probe]);

    act(() => ro.resize?.([{ target: content, contentRect: { height: 1000 } } as never]));

    ingestLiveFrame(liveReplies, 0);
    scroller.scrollHeight = 1150;
    act(() => ro.resize?.([{ target: content, contentRect: { height: 1150 } } as never]));

    // Follow ran first (to 750), then clamp ran in the same RO pass (to 688).
    expect(events).toEqual(['follow:750', 'clamp:688']);
    expect(scroller.scrollTop).toBe(688);

    act(() => renderer?.unmount());
    liveReplies.clear();
  });

  it('skips follow during an active disclosure reveal while still running end clamp', () => {
    const ro = stubResizeObserver();

    const { scroller } = createTrackedScroller();
    const content = {} as HTMLElement;
    const probe = {} as HTMLElement;
    const liveReplies = new LiveReplyStore();
    const atLiveEndRef = { current: true };
    let pending = 0;

    function Harness() {
      useTimelineLiveEnd({
        scrollElement: scroller as unknown as HTMLElement,
        contentRef: { current: content },
        footerProbeRef: { current: probe },
        isViewportAtBottomNow: () => isScrollNearBottom(scroller),
        atLiveEndRef,
        liveReplies,
        roomId: ROOM,
        pendingListShrinkPx: () => pending,
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Harness />);
    });
    act(() => ro.resize?.([{ target: content, contentRect: { height: 1000 } } as never]));

    ingestLiveFrame(liveReplies, 0);
    vi.mocked(isDisclosureRevealActive).mockReturnValue(true);
    pending = 62;
    scroller.scrollHeight = 1200;
    scroller.setScrollTopSilent(800);
    act(() => ro.resize?.([{ target: content, contentRect: { height: 1200 } } as never]));

    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(738);

    // Reveal finishes: framesAtGesture refreshed during reveal, so non-framed growth stays put.
    vi.mocked(isDisclosureRevealActive).mockReturnValue(false);
    pending = 0;
    scroller.scrollHeight = 1300;
    act(() => ro.resize?.([{ target: content, contentRect: { height: 1300 } } as never]));
    expect(scroller.scrollTo).not.toHaveBeenCalled();

    act(() => renderer?.unmount());
    liveReplies.clear();
  });

  it('shares one READER_INTENT_EVENTS registration and attaches when contentRef is null', () => {
    const ro = stubResizeObserver();

    const { scroller, addCounts } = createTrackedScroller();
    const content = {} as HTMLElement;
    const liveReplies = new LiveReplyStore();
    const atLiveEndRef = { current: true };
    const onReaderGesture = vi.fn();
    const cancelScroll = vi.fn();

    function WithContent() {
      useTimelineLiveEnd({
        surface: 'room',
        itemCount: 5,
        virtualizer: { scrollToIndex: vi.fn(), cancelScroll },
        opensAtLatest: true,
        scrollElement: scroller as unknown as HTMLElement,
        scrollToBottomRef: { current: { count: 0, smooth: false } },
        committedView: '!room||classic',
        onReaderGesture,
        contentRef: { current: content },
        isViewportAtBottomNow: () => isScrollNearBottom(scroller),
        atLiveEndRef,
        liveReplies,
        roomId: ROOM,
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<WithContent />);
    });
    for (const name of READER_INTENT_EVENTS) {
      expect(addCounts.get(name)).toBe(1);
    }

    act(() => ro.resize?.([{ target: content, contentRect: { height: 1000 } } as never]));
    ingestLiveFrame(liveReplies, 0);
    act(() => scroller.dispatch('pointerdown'));
    expect(cancelScroll).toHaveBeenCalledTimes(1);
    expect(onReaderGesture).toHaveBeenCalledTimes(1);

    // framesAtGesture advanced on pointerdown, so growth with no newer frame does not follow.
    scroller.scrollHeight = 1150;
    act(() => ro.resize?.([{ target: content, contentRect: { height: 1150 } } as never]));
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    act(() => renderer?.unmount());

    // Without contentRef.current, reader-intent listeners still attach and no RO is created.
    ro.count = 0;
    const nullContent = createTrackedScroller();
    const onNullContentGesture = vi.fn();
    function WithoutContent() {
      useTimelineLiveEnd({
        surface: 'room',
        itemCount: 5,
        virtualizer: { scrollToIndex: vi.fn(), cancelScroll: vi.fn() },
        opensAtLatest: true,
        scrollElement: nullContent.scroller as unknown as HTMLElement,
        scrollToBottomRef: { current: { count: 0, smooth: false } },
        committedView: '!room||classic',
        onReaderGesture: onNullContentGesture,
        contentRef: { current: null },
      });
      return null;
    }

    act(() => {
      renderer = create(<WithoutContent />);
    });
    expect(ro.count).toBe(0);
    for (const name of READER_INTENT_EVENTS) {
      expect(nullContent.addCounts.get(name)).toBe(1);
    }
    act(() => nullContent.scroller.dispatch('wheel'));
    expect(onNullContentGesture).toHaveBeenCalledTimes(1);
    act(() => renderer?.unmount());
    liveReplies.clear();
  });
});

describe('useHeldRowsLayout', () => {
  it('updates and clears spacer across consecutive deferred commits without getTotalSize', () => {
    stubPadding('0px', '40px');
    const content = makeBox(0, 540);
    const inner = {
      style: { height: '500px' },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => [],
    } as unknown as HTMLDivElement;

    let rowMove = false;
    let inRowReport = false;
    let totalSize = 500;
    let windowItems: VirtualItem[] = [
      makeVirtualItem(0, 100),
      makeVirtualItem(1, 200),
      makeVirtualItem(2, 500),
    ];
    let measurementsCache: VirtualItem[] = [...windowItems];
    const getTotalSize = vi.fn(() => totalSize);
    const ledger: HeldRowsLayoutLedger = {
      unrenderedRowMove: () => rowMove,
      unrenderedRewrap: () => false,
      unrenderedInRowReport: () => inRowReport,
      virtualInnerRef: { current: inner },
      virtualizer: {
        getTotalSize,
        getVirtualItems: () => windowItems,
        get measurementsCache() {
          return measurementsCache;
        },
      },
    };

    const snapshots: Array<{
      listHeight: number;
      listHeightHeld: boolean;
      heldEndSpacer: number;
      keys: VirtualItem['key'][];
      totalSizeCalls: number;
    }> = [];
    const onCommitRef: { current?: (index: number) => void } = {};

    function Harness() {
      const [, forceRender] = useReducer((value: number) => value + 1, 0);
      const layout: HeldRowsLayout = useHeldRowsLayout({
        ledger,
        itemCount: 3,
        contentRef: { current: content },
        latestAtTop: false,
        startAligned: true,
        forceRender,
      });
      useLayoutEffect(() => {
        const index = snapshots.length;
        snapshots.push({
          listHeight: layout.listHeight,
          listHeightHeld: layout.listHeightHeld,
          heldEndSpacer: layout.heldEndSpacer,
          keys: layout.virtualItems.map((item) => item.key),
          totalSizeCalls: getTotalSize.mock.calls.length,
        });
        onCommitRef.current?.(index);
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Harness />);
    });
    expect(snapshots).toEqual([
      {
        listHeight: 500,
        listHeightHeld: false,
        heldEndSpacer: 0,
        keys: [0, 1, 2],
        totalSizeCalls: 1,
      },
    ]);

    snapshots.length = 0;
    getTotalSize.mockClear();
    rowMove = true;
    inRowReport = true;
    measurementsCache = [makeVirtualItem(0, 100), makeVirtualItem(1, 200), makeVirtualItem(2, 580)];
    // Window gained an overscan item (key 3) during the RO pass; it stays deferred until unheld.
    windowItems = [...measurementsCache, makeVirtualItem(3, 680)];
    onCommitRef.current = (commitIndex) => {
      if (commitIndex === 0) {
        // Second consecutive ResizeObserver pass arrives before the first deferred render settles.
        measurementsCache = [
          makeVirtualItem(0, 100),
          makeVirtualItem(1, 200),
          makeVirtualItem(2, 620),
        ];
        windowItems = [...measurementsCache, makeVirtualItem(3, 720)];
      } else if (commitIndex === 1) {
        rowMove = false;
        inRowReport = false;
        totalSize = 620;
      }
    };

    act(() => {
      renderer?.update(<Harness />);
    });

    expect(snapshots).toEqual([
      {
        listHeight: 500,
        listHeightHeld: true,
        heldEndSpacer: 80,
        keys: [0, 1, 2],
        totalSizeCalls: 0,
      },
      {
        listHeight: 500,
        listHeightHeld: true,
        heldEndSpacer: 120,
        keys: [0, 1, 2],
        totalSizeCalls: 0,
      },
      {
        listHeight: 620,
        listHeightHeld: false,
        heldEndSpacer: 0,
        keys: [0, 1, 2, 3],
        totalSizeCalls: 1,
      },
    ]);

    act(() => renderer?.unmount());
  });
});
