// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { createElement, Fragment, useLayoutEffect, type PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOUSE_REST_HOLD_MS,
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
    const content = document.createElement('div');
    view.append(content);
    let offset = scrollTop;
    const writes: number[] = [];
    Object.defineProperty(view, 'scrollTop', {
      get: () => offset,
      set: (value: number) => {
        writes.push(value);
        offset = value;
      },
    });
    // Where the view starts on the page: its rows are that far down as well.
    let viewTop = 0;
    view.getBoundingClientRect = () => ({ top: viewTop, bottom: viewTop + 400 } as DOMRect);
    const show = (shownIds: string[]) => {
      let rowTop = 0;
      content.replaceChildren(
        ...shownIds.map((id) => {
          const row = document.createElement('div');
          const isHeader = sectionOfRow(id) !== undefined;
          if (!isHeader) row.setAttribute('data-scroll-anchor', id);
          else {
            row.setAttribute('data-compact-section', id);
            row.setAttribute('data-motion-row', id);
          }
          const height = isHeader ? SECTION_HEADER : CARD;
          const start = rowTop;
          rowTop += height;
          row.getBoundingClientRect = () => {
            const top = viewTop + start - offset;
            return { top, bottom: top + height } as DOMRect;
          };
          return row;
        })
      );
    };
    show(ids);
    // The observer's callback, and the elements it watches.
    let resize: (() => void) | undefined;
    const observed = new Set<Element>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }

        observe = (target: Element) => observed.add(target);

        disconnect = () => observed.clear();
      }
    );
    const viewRef = { current: view };
    const contentRef = { current: content };
    const foldingRef = { current: false };
    const List = ({ order, commit }: { order: string[]; commit?: () => void }) =>
      createElement(
        Fragment,
        null,
        useCompactScrollAnchor(order, viewRef, sectionOfRow, contentRef, foldingRef),
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
      /** The reader opens or closes a section: the next commit shows it. */
      fold: () => {
        foldingRef.current = true;
      },
      /** The page moves the whole view down. */
      moveView: (by: number) => {
        viewTop += by;
      },
      /** The cards' container changed size outside a commit, as told to those that watch it. */
      resize: () =>
        act(() => {
          if (observed.has(content)) resize?.();
        }),
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

  it('leaves the list alone in the commit that opens or closes a section for the reader', () => {
    const later = ['#later', '$c', '$d', '$e', '$f'];
    const ids = ['#needsYou', '$a', '$b', '#working', ...later];
    // The folded section's header is the topmost row in view.
    const { view, show, writes, rerender, fold } = list(ids, SECTION_HEADER + 2 * CARD);
    const open = ['#needsYou', '$a', '$b', '#working', '$w1', '$w2', ...later];
    fold();
    rerender(open, () => show(open));
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(SECTION_HEADER + 2 * CARD);

    fold();
    rerender(ids, () => show(ids));
    expect(writes).toEqual([]);

    // The next commit keeps the cards in place again.
    rerender(open, () => show(open));
    expect(writes).toEqual([SECTION_HEADER + 4 * CARD]);
  });

  it('keeps the cards in view in place when a card joins right under the header that leads the view', () => {
    const ids = ['#needsYou', '$a', '$b', '#working', '$c', '$d', '$e', '$f'];
    const { view, show, writes, rerender } = list(ids, SECTION_HEADER + 2 * CARD);
    const topOfC = () =>
      view.querySelector('[data-scroll-anchor="$c"]')!.getBoundingClientRect().top;
    expect(topOfC()).toBe(SECTION_HEADER);
    const next = ['#needsYou', '$a', '$b', '#working', '$new', '$c', '$d', '$e', '$f'];
    rerender(next, () => show(next));
    expect(writes).toEqual([SECTION_HEADER + 3 * CARD]);
    expect(topOfC()).toBe(SECTION_HEADER);
  });

  it('keeps the next section in place when the last card of a section leaves, its header kept', () => {
    const later = ['#later', '$c', '$d', '$e', '$f'];
    const ids = ['#needsYou', '$a', '#working', '$w', ...later];
    // The Working header leads the view, with its one card and the next section under it.
    const { view, show, writes, rerender } = list(ids, SECTION_HEADER + CARD);
    const topOfC = () =>
      view.querySelector('[data-scroll-anchor="$c"]')!.getBoundingClientRect().top;
    const top = topOfC();
    // The card leaves while the pointer holds the order, so its header stays: no fold.
    const held = ['#needsYou', '$a', '#working', ...later];
    rerender(held, () => show(held));
    expect(writes).toEqual([SECTION_HEADER]);
    expect(topOfC()).toBe(top);
  });

  it('does not take the whole view moving down the page for its cards moving', () => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes, resize, moveView } = list(ids, 250);
    // A row above the room (a call to return to) pushes the view down.
    moveView(48);
    resize();
    expect(writes).toEqual([]);

    // A card that joins above is still made up for.
    show(['$new', ...ids]);
    resize();
    expect(writes).toEqual([350]);
    expect(view.scrollTop).toBe(350);
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

  it.each(['a commit', 'a resize'])(
    "leaves the list where another script put it until that scroll's event has come (%s)",
    (how) => {
      const ids = ['$c', '$b', '$a'];
      const { view, show, writes, rerender, resize } = list(ids, 150);
      const change = (next: string[]) => {
        if (how === 'a commit') {
          rerender(next, () => show(next));
          return;
        }
        // A resize before the change as well, as the list that reopens has one of its own.
        resize();
        show(next);
        resize();
      };
      // The list reopens where it was left, and a card joins above before the scroll event.
      view.scrollTop = 250;
      writes.length = 0;
      change(['$d', ...ids]);
      expect(writes).toEqual([]);

      view.dispatchEvent(new Event('scroll'));
      change(['$e', '$d', ...ids]);
      expect(writes).toEqual([350]);
    }
  );

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

  it('keeps no card that is below the view: with only headers in view, nothing is written', () => {
    const headers = Array.from({ length: 13 }, (_, index) => `#section-${index}`);
    const ids = ['$a', '$b', ...headers, '$z'];
    // The two cards are above the view and the headers fill it: $z starts below its end.
    const { show, writes, rerender, resize } = list(ids, 2 * CARD);
    const next = ['$a', '$b', ...headers, '$y', '$z'];
    rerender(next, () => show(next));
    expect(writes).toEqual([]);

    show([...next.slice(0, -1), '$x', '$z']);
    resize();
    expect(writes).toEqual([]);
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
    'keeps the cards in place right after a %s too: a swipe or a sideways wheel scrolls nothing',
    (input) => {
      const ids = ['$c', '$b', '$a'];
      const { view, show, writes, rerender } = list(ids, 150);
      view.dispatchEvent(new Event(input, { bubbles: true }));
      rerender(['$d', ...ids], () => show(['$d', ...ids]));
      expect(writes).toEqual([250]);
    }
  );
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
