import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isScrollNearBottom } from './timelineScrollUtils';
import { useFollowContentGrowth } from './useFollowContentGrowth';

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

const createScroller = () => {
  const scrollListeners = new Set<() => void>();
  const scroller = {
    scrollHeight: 1000,
    clientHeight: 400,
    offsetHeight: 400,
    scrollTop: 600,
    addEventListener: (_type: string, listener: () => void) => scrollListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => scrollListeners.delete(listener),
    scrollTo: vi.fn(({ top }: { top: number }) => {
      scroller.scrollTop = top;
      scroller.scroll();
    }),
    scroll: () => scrollListeners.forEach((listener) => listener()),
  };
  return scroller;
};

describe('useFollowContentGrowth', () => {
  let resize: ResizeCallback | undefined;
  let renderer: ReactTestRenderer | undefined;
  const content = {} as HTMLElement;
  let scroller: ReturnType<typeof createScroller>;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeCallback) {
          resize = callback;
        }

        observe = vi.fn();

        disconnect = vi.fn();
      }
    );
    scroller = createScroller();
    const getScrollElement = () => scroller as unknown as HTMLElement;
    // The timeline's live reading of its viewport bottom.
    const isViewportAtBottomNow = () => isScrollNearBottom(scroller);
    const contentRef = { current: content };
    function Harness() {
      useFollowContentGrowth(getScrollElement, contentRef, isViewportAtBottomNow);
      return null;
    }
    act(() => {
      renderer = create(<Harness />);
    });
    act(() => resize?.([{ target: content, contentRect: { height: 1000 } } as never]));
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  const grow = (px: number, { correction = 0 } = {}) => {
    scroller.scrollHeight += px;
    scroller.scrollTop += correction;
    act(() =>
      resize?.([{ target: content, contentRect: { height: scroller.scrollHeight } } as never])
    );
  };

  it('keeps a reader at the bottom there while the content grows', () => {
    grow(120);

    expect(scroller.scrollTop).toBe(720);

    grow(80);

    expect(scroller.scrollTop).toBe(800);
  });

  it('leaves a reader who scrolled up where they are', () => {
    scroller.scrollTop = 500;
    scroller.scroll();

    grow(120);

    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(500);
  });

  it('leaves a reader near the bottom whom a measurement correction moves with the growth', () => {
    scroller.scrollTop = 500;
    scroller.scroll();

    grow(300, { correction: 300 });

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
});
