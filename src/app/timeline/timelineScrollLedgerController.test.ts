import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomAutomaticFill } from './roomAutomaticFill';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

vi.mock('../ui/styles/threadHeaderInset', () => ({ readTopInset: () => 0 }));

const virtualizerState = vi.hoisted(() => ({
  getVirtualItems: vi.fn<() => { key: string; start: number; size: number }[]>(() => []),
  itemSizeCache: new Map<string, number>(),
  options: {},
  scrollOffset: 0,
  setOptions: vi.fn(),
  cancelScroll: vi.fn(),
  measureElement: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  measureElement: vi.fn(() => 0),
  observeElementRect: vi.fn(() => () => {}),
  useVirtualizer: (options: Record<string, unknown>) => {
    virtualizerState.options = options;
    return {
      get options() {
        return virtualizerState.options;
      },
      get scrollOffset() {
        return virtualizerState.scrollOffset;
      },
      set scrollOffset(value: number) {
        virtualizerState.scrollOffset = value;
      },
      getVirtualItems: virtualizerState.getVirtualItems,
      itemSizeCache: virtualizerState.itemSizeCache,
      setOptions: virtualizerState.setOptions,
      cancelScroll: virtualizerState.cancelScroll,
      measureElement: virtualizerState.measureElement,
    };
  },
}));

describe('useTimelineScrollLedgerController', () => {
  it('allows a measured empty room to request its initial history', () => {
    const checks: (() => void)[] = [];
    const geometryReader = { current: () => undefined as string | undefined };
    const owner = createRoomAutomaticFill({
      readGeometry: () => geometryReader.current(),
      schedule: (check) => {
        checks.push(check);
      },
    });
    const root = {
      clientHeight: 600,
      scrollTop: 0,
      scrollHeight: 600,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;
    const inner = { style: {} };
    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        estimateSize: () => 144,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 0,
        roomId: '!room:example.org',
        automaticFill: { geometryReader },
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
    };
    let holdBanner: (deltaPx: number, scrollTop: number) => void = () => undefined;

    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement: () => scroller as unknown as HTMLDivElement,
        itemCount: 2,
        roomId: '!room:example.org',
        threadId: '$root',
      });
      (controller.virtualInnerRef as { current: unknown }).current = inner;
      holdBanner = controller.holdThreadBannerResize;
      return React.createElement('div', { ref: useRef<HTMLDivElement>(null) });
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
