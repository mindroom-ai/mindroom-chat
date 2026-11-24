import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import { createRoomAutomaticFill } from './roomAutomaticFill';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  getVirtualItemForOffset: (() => undefined) as (
    offset: number
  ) => { index: number; start: number } | undefined,
}));
const settleWaits = vi.hoisted(() => [] as Array<() => void>);

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./rideTraceRecorder', () => ({
  installRideTraceRecorder: vi.fn(),
  isRideTraceEnabled: () => false,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => true,
  waitForScrollQuiescence: () =>
    new Promise<void>((resolve) => {
      settleWaits.push(resolve);
    }),
}));

// The scroller's computed scroll-padding-top: the sticky headers' inset.
const scrollPadding = { top: 0 };

beforeEach(() => {
  scrollPadding.top = 0;
  vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: `${scrollPadding.top}px` }));
  virtualizer.itemSizeCache = new Map();
  virtualizer.options = {};
  virtualizer.setOptions.mockClear();
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
  virtualizer.getVirtualItemForOffset = () => undefined;
  settleWaits.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTimelineScrollLedgerController', () => {
  it('commits shrink compensation before child layout reads can clamp the native offset', () => {
    let scrollTop = 3400;
    let height = 4000;
    const inner = { style: { marginTop: '' } };
    const root = {
      addEventListener: () => {},
      removeEventListener: () => {},
      get scrollTop() {
        const margin = Number.parseFloat(inner.style.marginTop) || 0;
        scrollTop = Math.min(scrollTop, height + margin - 600);
        return scrollTop;
      },
    } as unknown as HTMLDivElement;
    const seen: number[] = [];
    const ReadLayout = ({ debt }: { debt: number }) => {
      React.useLayoutEffect(() => {
        // Host height is committed before child callback refs/layout effects.
        height = 4000 + debt;
        seen.push(root.scrollTop);
      });
      return null;
    };
    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 100,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 40,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 100),
        roomId: '!room:example.org',
      });
      return React.createElement(
        'inner',
        { ref: controller.virtualInnerRef },
        React.createElement(ReadLayout, { debt: controller.ledgerPxAtRender })
      );
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), { createNodeMock: () => inner });
    });
    expect(seen).toEqual([3400]);
    const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number },
      delta: number,
      instance: { scrollOffset: number; scrollDirection: null }
    ) => boolean;
    act(() => {
      correction({ end: 100 }, -200, { scrollOffset: 3400, scrollDirection: null });
    });
    expect(seen.at(-1)).toBe(3400);
    expect(inner.style.marginTop).toBe('200px');
    // Settlement can clear the imperative margin. An equal snapshot must
    // restore it on the next commit even if React props would compare equal.
    inner.style.marginTop = '';
    act(() => renderer.update(React.createElement(Harness)));
    expect(seen.at(-1)).toBe(3400);
    expect(inner.style.marginTop).toBe('200px');
    act(() => renderer.unmount());
  });

  it('allows a measured empty room to request its initial history', () => {
    const checks: (() => void)[] = [];
    const geometryReader = { current: (): string | undefined => undefined };
    const owner = createRoomAutomaticFill({
      readGeometry: () => geometryReader.current(),
      schedule: (check) => {
        checks.push(check);
      },
    });
    const root = {
      scrollTop: 0,
      scrollHeight: 600,
      clientHeight: 600,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLDivElement;
    const inner = { style: { marginTop: '' } };
    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 144,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 0,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 144),
        roomId: '!room:example.org',
        automaticFill: { ...owner, geometryReader },
      });
      return React.createElement('inner', { ref: controller.virtualInnerRef });
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), { createNodeMock: () => inner });
    });
    let requests = 0;
    owner.defer(() => {
      requests += 1;
      return false;
    });
    checks.shift()?.();
    checks.shift()?.();
    expect(requests).toBe(1);
    act(() => renderer.unmount());
  });

  it('defers a settle until the painted margin catches up with the live ledger', async () => {
    let scrollTop = 5000;
    const writes: number[] = [];
    const scrollElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
      clientHeight: 600,
      scrollHeight: 20_000,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        writes.push(value);
        scrollTop = value;
      },
    } as unknown as HTMLDivElement;
    const innerElement = {
      style: { marginTop: '' } as CSSStyleDeclaration,
      getBoundingClientRect: () => ({ top: -5000, bottom: 15_000 }),
    } as unknown as HTMLDivElement;

    const Harness = () => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement: () => scrollElement,
        itemCount: 1,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
      });
      return React.createElement('inner', { ref: controller.virtualInnerRef });
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), {
        createNodeMock: () => innerElement,
      });
    });
    const adjustment = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number },
      delta: number,
      instance: { scrollOffset: number | null; scrollDirection: 'forward' | 'backward' | null }
    ) => boolean;
    act(() => {
      expect(adjustment({ end: 100 }, -5, { scrollOffset: 5000, scrollDirection: null })).toBe(
        false
      );
    });
    expect(innerElement.style.marginTop).toBe('5px');
    expect(settleWaits).toHaveLength(1);

    // Exact trace shape: React has not yet painted the accumulator's newer
    // -5px snapshot, so the DOM still carries the previous 512px ledger.
    innerElement.style.marginTop = '-512px';
    await act(async () => {
      settleWaits[0]!();
      await Promise.resolve();
    });
    expect(writes).toEqual([]);
    expect(innerElement.style.marginTop).toBe('5px');
    expect(settleWaits).toHaveLength(2);

    await act(async () => {
      settleWaits[1]!();
      await Promise.resolve();
    });
    expect(writes).toEqual([4995]);
    expect(innerElement.style.marginTop).toBe('');

    act(() => renderer.unmount());
  });

  it('resets the boundary direction baseline at touch start', () => {
    let scrollTop = 34_331;
    const writes: number[] = [];
    const listeners = new Map<string, EventListener>();
    const scrollElement = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
      clientHeight: 600,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        writes.push(value);
        scrollTop = value;
      },
    } as unknown as HTMLDivElement;
    const innerElement = {
      style: {} as CSSStyleDeclaration,
      getBoundingClientRect: () => ({ top: -34_000, bottom: 1600 }),
    } as unknown as HTMLDivElement;
    const getScrollElement = () => scrollElement;

    const Harness = () => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement,
        itemCount: 1,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
      });
      return React.createElement('inner', { ref: controller.virtualInnerRef });
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), {
        createNodeMock: () => innerElement,
      });
    });

    expect(scrollElement.addEventListener).toHaveBeenCalledWith(
      'touchstart',
      expect.any(Function),
      { capture: true, passive: true }
    );
    const adjustment = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number },
      delta: number,
      instance: { scrollOffset: number | null; scrollDirection: 'forward' | 'backward' | null }
    ) => boolean;
    act(() => {
      expect(adjustment({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
        false
      );
    });

    // The compositor advances without a scroll event, then a new touch
    // reverses. Comparing the first reversed frame with the old 34331px
    // baseline would misclassify it as forward and settle the +72px ledger.
    scrollTop = 34_431;
    listeners.get('touchstart')?.(new Event('touchstart'));
    scrollTop = 34_396;
    listeners.get('scroll')?.(new Event('scroll'));
    expect(writes).toEqual([]);

    // A later genuine move toward the guarded bottom still settles.
    scrollTop = 34_420;
    listeners.get('scroll')?.(new Event('scroll'));
    expect(writes).toEqual([34_492]);

    const touchStartListener = listeners.get('touchstart');
    act(() => renderer.unmount());
    expect(scrollElement.removeEventListener).toHaveBeenCalledWith(
      'touchstart',
      touchStartListener,
      true
    );
  });

  describe('thread banner resize', () => {
    const listTopRef = { current: 0 };
    const scroller = {
      getBoundingClientRect: () => ({ top: 100 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      scrollTop: 300,
    };
    const inner = {
      getBoundingClientRect: () => ({ top: listTopRef.current }),
      style: { marginTop: '' },
    };
    let holdBanner: (deltaPx: number, scrollTop: number) => void = () => undefined;
    let latestLedgerPx = 0;

    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement: () => scroller as unknown as HTMLDivElement,
        itemCount: 2,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 10),
        roomId: '!room:example.org',
        threadId: '$root',
      });
      (controller.virtualInnerRef as { current: unknown }).current = inner;
      latestLedgerPx = controller.ledgerPxAtRender;
      holdBanner = controller.holdThreadBannerResize;
      return null;
    };
    let renderer: ReturnType<typeof create> | undefined;

    beforeEach(() => {
      scroller.scrollTop = 300;
      listTopRef.current = 0;
      act(() => {
        renderer = create(React.createElement(Harness));
      });
    });
    afterEach(() => {
      act(() => renderer?.unmount());
      renderer = undefined;
    });

    it('holds a reader in the rows when the banner above them changes height', () => {
      holdBanner(22, 300);
      expect(scroller.scrollTop).toBe(322);
      // At the bottom, the layout of the shrunk header has clamped the live offset.
      scroller.scrollTop = 310;
      holdBanner(-22, 322);
      expect(scroller.scrollTop).toBe(300);
      // A single change, not a ledger debt left to settle at rest.
      expect(latestLedgerPx).toBe(0);
    });

    it('lets a reader above the rows see the banner change', () => {
      listTopRef.current = 150;
      holdBanner(22, 300);
      expect(scroller.scrollTop).toBe(300);
    });

    it('leaves a reader at the very top there', () => {
      scroller.scrollTop = 0;
      listTopRef.current = 100;
      holdBanner(22, 0);
      expect(scroller.scrollTop).toBe(0);
    });
  });
});

describe("the room's start as virtual item 0", () => {
  const scroller = {
    getBoundingClientRect: () => ({ top: 100 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    scrollTop: 0,
  };
  const inner = { getBoundingClientRect: () => ({ top: 0 }), style: { marginTop: '' } };
  let ledgerPx = 0;

  const Harness = ({ hasRoomIntro }: { hasRoomIntro: boolean }) => {
    const pendingRoomFoldPxRef = useRef(0);
    const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
      () => 10
    );
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: (index) => (hasRoomIntro && index === 0 ? 160.5 : 10),
      getItemKey: (index) => (hasRoomIntro && index === 0 ? '__room_intro__' : index),
      getScrollElement: () => scroller as unknown as HTMLDivElement,
      itemCount: hasRoomIntro ? 4 : 3,
      pendingRoomFoldPxRef,
      roomFoldPriceRef,
      roomId: '!room:example.org',
      hasRoomIntro,
    });
    (controller.virtualInnerRef as { current: unknown }).current = inner;
    ledgerPx = controller.ledgerPxAtRender;
    return null;
  };

  const showIntro = (scrollTop: number) => {
    scroller.scrollTop = scrollTop;
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(React.createElement(Harness, { hasRoomIntro: false }));
    });
    act(() => {
      renderer?.update(React.createElement(Harness, { hasRoomIntro: true }));
    });
    renderer?.unmount();
  };

  it('holds a reader below row 0 when the intro prepends as item 0', () => {
    showIntro(400);
    expect(ledgerPx).toBe(160.5);
  });

  it('lets a reader at the top see the intro arrive', () => {
    showIntro(0);
    expect(ledgerPx).toBe(0);
  });
});
