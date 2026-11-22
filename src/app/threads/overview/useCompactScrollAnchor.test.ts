// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { createElement, Fragment, useLayoutEffect, type PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOUSE_REST_HOLD_MS,
  SCROLL_SETTLE_MS,
  useCompactScrollAnchor,
  usePointerOverCards,
} from './useCompactScrollAnchor';

describe('useCompactScrollAnchor', () => {
  const CARD = 100;

  const SECTION_HEADER = 32;
  const sectionOfRow = (id: string) => (id.startsWith('#') ? id : undefined);

  /** Changes the page as a commit does: after the cards were read, before the list's effects. */
  const Commit = ({ run }: { run?: () => void }) => {
    useLayoutEffect(() => run?.());
    return null;
  };

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
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }

        observe = () => undefined;

        disconnect = () => undefined;
      }
    );
    const viewRef = { current: view };
    const List = ({ order, commit }: { order: string[]; commit?: () => void }) =>
      createElement(
        Fragment,
        null,
        useCompactScrollAnchor(order, viewRef, sectionOfRow),
        createElement(Commit, { run: commit })
      );
    const { rerender } = render(createElement(List, { order: ids }));
    return {
      view,
      show,
      writes,
      /** A commit that renders `order`; `commit` changes the page inside it. */
      rerender: (order: string[], commit?: () => void) =>
        rerender(createElement(List, { order, commit })),
      /** The reader scrolls; the browser fires the scroll event at its next frame. */
      scrollBy: (delta: number) => {
        offset += delta;
      },
      /** The list or one of its cards changed size outside a commit. */
      resize: () => act(() => resize?.()),
    };
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not undo the reader's scroll that a render sees before its scroll event", () => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, writes, scrollBy, rerender } = list(ids, 150);
    scrollBy(100);
    // An index refresh renders the same threads before the scroll event fires.
    rerender([...ids]);
    expect(view.scrollTop).toBe(250);
    expect(writes).toEqual([]);
  });

  it('keeps the cards in view in place when a card joins above them', () => {
    const ids = ['$c', '$b', '$a'];
    const { view, show, rerender } = list(ids, 150);
    rerender(['$d', ...ids], () => show(['$d', ...ids]));
    expect(view.scrollTop).toBe(250);
  });

  it('shows a reader at the top the card that joins there', () => {
    const ids = ['$c', '$b', '$a'];
    const { show, writes, rerender } = list(ids, 0);
    rerender(['$d', ...ids], () => show(['$d', ...ids]));
    expect(writes).toEqual([]);
  });

  it('keeps its place when the topmost card in view moves to the top, by the card after it', () => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes, rerender } = list(ids, 250);
    // $c, topmost in view, got a reply and leads the live order.
    const live = ['$c', '$a', '$b', '$d', '$e', '$f'];
    rerender(live, () => show(live));
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(250);
  });

  it.each([
    ['the topmost card in view', ['$a', '$b', '$d', '$e', '$f', '$c'], '$d'],
    ['a card above the view', ['$b', '$c', '$d', '$e', '$f', '$a'], '$c'],
  ])('anchors the stationary cards when %s moves down', (_label, live, anchor) => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes, rerender } = list(ids, 250);
    const topOf = () =>
      view.querySelector(`[data-scroll-anchor="${anchor}"]`)!.getBoundingClientRect().top;
    const top = topOf();
    rerender(live, () => show(live));
    expect(writes).toEqual([150]);
    expect(topOf()).toBe(top);
  });

  it('anchors the topmost card when the card just above moves down into a new section', () => {
    const later = ['#later', '$c', '$d', '$e', '$f'];
    const ids = ['#needsYou', '$a', '$b', ...later];
    const { view, show, writes, rerender } = list(ids, SECTION_HEADER + CARD + 10);
    const topOfB = () =>
      view.querySelector('[data-scroll-anchor="$b"]')!.getBoundingClientRect().top;
    expect(topOfB()).toBe(-10);

    // A and B swap relative order, but only A changed sections. B should still anchor.
    const order = ['#needsYou', '$b', '#working', '$a', ...later];
    rerender(order, () => show(order));
    expect(topOfB()).toBe(-10);
    expect(writes).toEqual([SECTION_HEADER + 10]);
  });

  it("does not move the list on top of another script's scroll, such as the list reopening on a card", () => {
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes, rerender } = list(ids, 150);
    // A card lands above, and another script already scrolled by as much to keep its card in view.
    show(['$d', ...ids]);
    view.scrollTop = 250;
    writes.length = 0;
    rerender(['$d', ...ids]);
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(250);
  });

  it.each([
    ['scrolls to the top (WebKit)', 0],
    ['follows the thread that sorted first, or the focus React puts back (Chromium)', 40],
  ])('puts the cards in view back when the commit of a new order %s', (_label, scrolledTo) => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes, rerender } = list(ids, 250);
    // $f, below the view, got a reply: React moves every other row to put it first.
    const live = ['$f', '$a', '$b', '$c', '$d', '$e'];
    rerender(live, () => {
      show(live);
      view.scrollTop = scrolledTo;
      writes.length = 0;
    });
    expect(writes).toEqual([350]);
  });

  it('keeps the cards in view in place when a card above them grows outside a commit', () => {
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes, resize } = list(ids, 150);
    show(['$d', ...ids]);
    expect(writes).toEqual([]);
    resize();
    expect(writes).toEqual([250]);

    // Another script's scroll placed the list: the cards are read again where it left them.
    show(['$e', '$d', ...ids]);
    view.scrollTop = 300;
    resize();
    expect(writes).toEqual([250, 300]);
  });

  it('anchors a card below the floating header, not one it hides', () => {
    const ids = ['$a', '$b', '$c', '$d', '$e'];
    const { view, show, writes, rerender } = list(ids, 120);
    // The header covers 120 px: $b ends under it, and $c is the first card the reader sees.
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: '120px' }));
    view.dispatchEvent(new Event('scroll'));
    // A card joins between the two.
    const next = ['$a', '$b', '$new', '$c', '$d', '$e'];
    rerender(next, () => show(next));
    expect(writes).toEqual([220]);
  });

  it.each(['wheel', 'touchmove'])(
    'scrolls by what a change during a %s scroll moved the cards once the scroll settles',
    (input) => {
      vi.useFakeTimers();
      const ids = ['$c', '$b', '$a'];
      const { view, show, writes, rerender, scrollBy } = list(ids, 150);
      view.dispatchEvent(new Event(input));
      rerender(['$d', ...ids], () => show(['$d', ...ids]));
      expect(writes).toEqual([]);

      // The scroll goes on (momentum), and each of its events holds the write back.
      vi.advanceTimersByTime(SCROLL_SETTLE_MS - 1);
      scrollBy(-20);
      view.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(SCROLL_SETTLE_MS - 1);
      expect(writes).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(writes).toEqual([230]);

      // The list's own scroll is no scrolling of the reader's.
      view.dispatchEvent(new Event('scroll'));
      rerender(['$e', '$d', ...ids], () => show(['$e', '$d', ...ids]));
      expect(writes).toEqual([230, 330]);
    }
  );

  it('scrolls at once, also during a scroll, when the commit itself moved the list', () => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes, rerender } = list(ids, 250);
    view.dispatchEvent(new Event('wheel'));
    const live = ['$f', '$a', '$b', '$c', '$d', '$e'];
    rerender(live, () => {
      show(live);
      view.scrollTop = 0;
    });
    expect(writes).toEqual([0, 350]);
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
