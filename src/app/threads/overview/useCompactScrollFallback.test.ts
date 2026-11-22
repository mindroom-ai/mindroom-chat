// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOUSE_REST_HOLD_MS,
  useCompactScrollFallback,
  usePointerOverCards,
} from './useCompactScrollFallback';

describe('useCompactScrollFallback', () => {
  const CARD = 100;

  const SECTION_HEADER = 32;
  const sectionOfRow = (id: string) => (id.startsWith('#') ? id : undefined);

  /** A list scrolled `scrollTop` down, with optional section headers in the order `ids`. */
  const list = (ids: string[], scrollTop: number) => {
    const view = document.createElement('div');
    let offset = scrollTop;
    const writes: number[] = [];
    Object.defineProperty(view, 'scrollTop', {
      get: () => offset,
      set: (value: number) => {
        writes.push(value);
        offset = value;
      },
    });
    view.getBoundingClientRect = () => ({ top: 0, bottom: 400 } as DOMRect);
    const show = (shownIds: string[]) => {
      let rowTop = 0;
      view.replaceChildren(
        ...shownIds.map((id) => {
          const row = document.createElement('div');
          const isHeader = sectionOfRow(id) !== undefined;
          if (!isHeader) row.setAttribute('data-scroll-anchor', id);
          const height = isHeader ? SECTION_HEADER : CARD;
          const start = rowTop;
          rowTop += height;
          row.getBoundingClientRect = () => {
            const top = start - offset;
            return { top, bottom: top + height } as DOMRect;
          };
          return row;
        })
      );
    };
    show(ids);
    return {
      view,
      show,
      writes,
      /** The reader scrolls; the browser fires the scroll event at its next frame. */
      scrollBy: (delta: number) => {
        offset += delta;
      },
    };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withoutScrollAnchoring = () =>
    vi.stubGlobal('CSS', { supports: (property: string) => property !== 'overflow-anchor' });

  it("does not undo the reader's scroll that a render sees before its scroll event", () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, writes, scrollBy } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    scrollBy(100);
    // An index refresh renders the same threads before the scroll event fires.
    rerender({ live: [...ids] });
    expect(view.scrollTop).toBe(250);
    expect(writes).toEqual([]);
  });

  it('keeps the cards in view in place when a card joins above them, without scroll anchoring', () => {
    withoutScrollAnchoring();
    const ids = ['$c', '$b', '$a'];
    const { view, show } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    show(['$d', ...ids]);
    rerender({ live: ['$d', ...ids] });
    expect(view.scrollTop).toBe(250);
  });

  it('keeps its place when the topmost card in view moves to the top, by the card after it', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes } = list(ids, 250);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    // $c, topmost in view, got a reply and leads the live order.
    const live = ['$c', '$a', '$b', '$d', '$e', '$f'];
    show(live);
    rerender({ live });
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(250);
  });

  it.each([
    ['the topmost card in view', ['$a', '$b', '$d', '$e', '$f', '$c'], '$d'],
    ['a card above the view', ['$b', '$c', '$d', '$e', '$f', '$a'], '$c'],
  ])('anchors the stationary cards when %s moves down', (_label, live, anchor) => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes } = list(ids, 250);
    const topOf = () =>
      view.querySelector(`[data-scroll-anchor="${anchor}"]`)!.getBoundingClientRect().top;
    const { rerender } = renderHook(
      ({ order }) => useCompactScrollFallback(order, { current: view }),
      { initialProps: { order: ids } }
    );
    const top = topOf();
    show(live);
    rerender({ order: live });
    expect(writes).toEqual([150]);
    expect(topOf()).toBe(top);
  });

  it('anchors the topmost card when the card just above moves down into a new section', () => {
    withoutScrollAnchoring();
    const later = ['#later', '$c', '$d', '$e', '$f'];
    const ids = ['#needsYou', '$a', '$b', ...later];
    const { view, show, writes } = list(ids, SECTION_HEADER + CARD + 10);
    const topOfB = () =>
      view.querySelector('[data-scroll-anchor="$b"]')!.getBoundingClientRect().top;
    const { rerender } = renderHook(
      ({ order }) => useCompactScrollFallback(order, { current: view }, sectionOfRow),
      { initialProps: { order: ids } }
    );
    expect(topOfB()).toBe(-10);

    // A and B swap relative order, but only A changed sections. B should still anchor.
    const order = ['#needsYou', '$b', '#working', '$a', ...later];
    show(order);
    rerender({ order });
    expect(topOfB()).toBe(-10);
    expect(writes).toEqual([SECTION_HEADER + 10]);
  });

  it("does not move the list on top of another script's scroll, such as the list reopening on a card", () => {
    withoutScrollAnchoring();
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    // A card lands above, and another script already scrolled by as much to keep its card in view.
    show(['$d', ...ids]);
    view.scrollTop = 250;
    writes.length = 0;
    rerender({ live: ['$d', ...ids] });
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(250);
  });

  it('restores the cards in view when WebKit resets scrollTop to 0 during a reorder commit', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes } = list(ids, 250);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    // $f from below moves to the top, and WebKit resets scrollTop to 0 during React's insertBefore.
    const live = ['$f', '$a', '$b', '$c', '$d', '$e'];
    show(live);
    view.scrollTop = 0;
    writes.length = 0;
    rerender({ live });
    expect(writes).toEqual([350]);
    expect(view.scrollTop).toBe(350);
  });

  it('does not undo a reader wheel scroll to 0 just before a reorder commit', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes } = list(ids, 250);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    const live = ['$f', '$a', '$b', '$c', '$d', '$e'];
    view.dispatchEvent(new Event('wheel'));
    show(live);
    view.scrollTop = 0;
    writes.length = 0;
    rerender({ live });
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(0);
  });

    it('compensates card height growth outside a parent commit via ResizeObserver', () => {
    withoutScrollAnchoring();
    let onResize: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect() {
          onResize = undefined;
        }
      }
    );
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes } = list(ids, 150);
    const content = document.createElement('div');
    renderHook(() => useCompactScrollFallback(ids, { current: view }, undefined, { current: content }));
    // Card above grows by 100 px without re-rendering the parent.
    show(['$d', ...ids]);
    expect(writes).toEqual([]);
    act(() => onResize?.());
    expect(writes).toEqual([250]);
    expect(view.scrollTop).toBe(250);
  });

  it('defers scrollTop writes while a wheel scroll is in progress and applies once settled', () => {
    vi.useFakeTimers();
    try {
      withoutScrollAnchoring();
      const ids = ['$c', '$b', '$a'];
      const { view, show, writes } = list(ids, 150);
      const { rerender } = renderHook(
        ({ live }) => useCompactScrollFallback(live, { current: view }),
        { initialProps: { live: ids } }
      );
      view.dispatchEvent(new Event('wheel'));
      show(['$d', ...ids]);
      rerender({ live: ['$d', ...ids] });
      expect(writes).toEqual([]);
      expect(view.scrollTop).toBe(150);
      act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));
      expect(writes).toEqual([250]);
      expect(view.scrollTop).toBe(250);
    } finally {
      vi.useRealTimers();
    }
  });

    it('anchors below scroll-padding-top rather than to a card hidden under the floating header', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e'];
    const { view, show, writes } = list(ids, 120);
    view.style.scrollPaddingTop = '120px';
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    // At scrollTop 120 with scrollPaddingTop 120, $b (bottom 80) is hidden under the header and
    // $c (top 80, bottom 180) is the first visible card below it. Growing $b must move scrollTop.
    const next = ['$a', '$b', '$extra', '$c', '$d', '$e'];
    show(next);
    rerender({ live: next });
    expect(writes).toEqual([220]);
  });

  it('compensates scroller padding-top changes when scrolled down even with native scroll anchoring', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = ['$c', '$b', '$a'];
    const { view, writes } = list(ids, 150);
    view.style.paddingTop = '120px';
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    view.style.paddingTop = '178px';
    rerender({ live: ids });
    expect(writes).toEqual([208]);
    view.style.paddingTop = '156px';
    rerender({ live: ids });
    expect(writes).toEqual([208, 186]);
  });

    it("leaves the cards in view to the browser's scroll anchoring where it has one", () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useCompactScrollFallback(live, { current: view }),
      { initialProps: { live: ids } }
    );
    show(['$d', ...ids]);
    rerender({ live: ['$d', ...ids] });
    expect(writes).toEqual([]);
  });
});

describe('usePointerOverCards', () => {
  const pointer = (pointerType: string) => ({ pointerType } as PointerEvent<HTMLElement>);

  it('lets a mouse go when it leaves', () => {
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    expect(result.current.pointerInside).toBe(true);
    act(() => result.current.onPointerLeave(pointer('mouse')));
    expect(result.current.pointerInside).toBe(false);
  });

  describe('a mouse at rest', () => {
    const mouse = (buttons = 0) => ({ pointerType: 'mouse', buttons } as PointerEvent<HTMLElement>);
    afterEach(() => {
      vi.useRealTimers();
    });

    it(`lets go once it rested ${MOUSE_REST_HOLD_MS} ms, and holds again at its next move`, () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerEnter(mouse()));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS - 1);
      });
      act(() => result.current.onPointerMove(mouse()));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS - 1);
      });
      expect(result.current.pointerInside).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.pointerInside).toBe(false);

      act(() => result.current.onPointerMove(mouse()));
      expect(result.current.pointerInside).toBe(true);
    });

    it('holds through a press however long, and rests again from its release', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerEnter(mouse()));
      act(() => result.current.onPointerDown(mouse(1)));
      act(() => result.current.onPointerMove(mouse(1)));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS * 2);
      });
      expect(result.current.pointerInside).toBe(true);

      act(() => result.current.onPointerUp(mouse()));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS);
      });
      expect(result.current.pointerInside).toBe(false);
    });

    it('keeps a pen that came after the mouse held when the mouse has rested', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerMove(mouse()));
      act(() => result.current.onPointerEnter(pointer('pen')));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS * 2);
      });
      expect(result.current.pointerInside).toBe(true);
    });

    it('lets no finger go by time', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerEnter(pointer('touch')));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS * 2);
      });
      expect(result.current.pointerInside).toBe(true);
    });
  });

  it("holds a finger that lifted until its tap's click", () => {
    // A finger's pointer leaves as it lifts; the tap's mousedown, mouseup and click come after.
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    act(() => result.current.onPointerLeave(pointer('touch')));
    expect(result.current.pointerInside).toBe(true);
    act(() => {
      document.body.click();
    });
    expect(result.current.pointerInside).toBe(false);
  });

  it('holds from a press, which renders before the enter of the same tap may', () => {
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerDown());
    expect(result.current.pointerInside).toBe(true);
  });

  it('lets a finger go at once when it scrolled instead of tapping', () => {
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    act(() => result.current.onPointerCancel());
    act(() => result.current.onPointerLeave(pointer('touch')));
    expect(result.current.pointerInside).toBe(false);
  });

  it('stops waiting for a click once unmounted', () => {
    const { result, unmount } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    act(() => result.current.onPointerLeave(pointer('touch')));
    unmount();
    expect(() => document.body.click()).not.toThrow();
  });
});
