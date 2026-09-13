import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import type { ThreadLedgerEvent } from './threadScrollLedger';
import { createRoomAutomaticFill } from './roomAutomaticFill';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: vi.fn(),
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
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

const event = (eventId: string): ThreadLedgerEvent => ({
  getId: () => eventId,
});

beforeEach(() => {
  virtualizer.itemSizeCache = new Map();
  virtualizer.options = {};
  virtualizer.setOptions.mockClear();
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
  settleWaits.length = 0;
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
        clearPendingThreadAnchor: () => {},
        estimateSize: () => 100,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 40,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 100),
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadInitialRenderMode: 'live',
        threadPaginatingBack: false,
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
        clearPendingThreadAnchor: () => {},
        estimateSize: () => 144,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 0,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 144),
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadInitialRenderMode: 'live',
        threadPaginatingBack: false,
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
        clearPendingThreadAnchor: vi.fn(),
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement: () => scrollElement,
        itemCount: 1,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadId: '$root',
        threadInitialRenderMode: 'live',
        threadPaginatingBack: false,
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
      settleWaits[0]();
      await Promise.resolve();
    });
    expect(writes).toEqual([]);
    expect(innerElement.style.marginTop).toBe('5px');
    expect(settleWaits).toHaveLength(2);

    await act(async () => {
      settleWaits[1]();
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
        clearPendingThreadAnchor: vi.fn(),
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement,
        itemCount: 1,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadId: '$root',
        threadInitialRenderMode: 'live',
        threadPaginatingBack: false,
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

  it('uses the latest committed events when an older async capture callback runs', () => {
    const root = event('$root');
    const oldRow = event('$old');
    const currentRow = event('$current');
    const insertedRow = event('$inserted');
    const anchor = event('$anchor');
    const initialEvents = [root, oldRow, anchor];
    const currentEvents = [root, currentRow, anchor];
    const prependedEvents = [root, insertedRow, currentRow, anchor];
    virtualizer.itemSizeCache = new Map([
      ['$old', 100],
      ['$current', 20],
      ['$inserted', 10],
    ]);

    let retainedCapture:
      | ReturnType<typeof useTimelineScrollLedgerController>['captureThreadPrepend']
      | undefined;
    let latestLedgerPx = 0;

    const Harness = ({ events }: { events: ThreadLedgerEvent[] }) => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        clearPendingThreadAnchor: vi.fn(),
        estimateSize: () => 10,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement: () => null,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(events.map((entry, index) => [entry.getId() ?? '', index])),
        threadEvents: events,
        threadId: '$root',
        threadInitialRenderMode: 'live',
        threadPaginatingBack: true,
        threadPendingAnchorSeq: 1,
      });
      retainedCapture ??= controller.captureThreadPrepend;
      latestLedgerPx = controller.ledgerPxAtRender;
      return null;
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { events: initialEvents }));
    });
    act(() => {
      renderer.update(React.createElement(Harness, { events: currentEvents }));
    });
    act(() => {
      retainedCapture?.({
        threadId: '$root',
        anchorEventId: '$anchor',
        anchorIndex: 2,
        anchorSeq: 1,
      });
      renderer.update(React.createElement(Harness, { events: prependedEvents }));
    });

    expect(latestLedgerPx).toBe(10);
    renderer.unmount();
  });
});
