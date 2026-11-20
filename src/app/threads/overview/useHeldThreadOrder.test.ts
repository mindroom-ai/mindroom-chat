// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOUSE_REST_HOLD_MS,
  rowsMovedUp,
  rowToPin,
  useHeldThreadOrder,
  usePointerOverCards,
  useRowKeys,
} from './useHeldThreadOrder';

describe('rowToPin', () => {
  const before = ['$a', '$b', '$c', '$d', '$e', '$f'];

  it('pins the row that leads the view when rows moved up past it', () => {
    expect(rowToPin(before, ['$f', '$a', '$b', '$c', '$d', '$e'], ['$b', '$c', '$d'])).toBe('$b');
    // A row in view moved up: the row above it still leads.
    expect(rowToPin(before, ['$d', '$a', '$b', '$c', '$e', '$f'], ['$b', '$c', '$d'])).toBe('$b');
    // The leading row itself moved up.
    expect(rowToPin(before, ['$b', '$a', '$c', '$d', '$e', '$f'], ['$b', '$c', '$d'])).toBe('$b');
  });

  it('pins the upper of two rows that swap', () => {
    expect(rowToPin(before, ['$b', '$a', '$c', '$d', '$e', '$f'], ['$a', '$b', '$c'])).toBe('$a');
  });

  it('pins the leading row when rows from under the next one came up past both', () => {
    // $c, $d and $e rotate above $a and $b, all five in view.
    const after = ['$c', '$d', '$e', '$a', '$b', '$f'];
    expect(rowToPin(before, after, ['$a', '$b', '$c', '$d', '$e'])).toBe('$a');
  });

  it('pins the next row in view when the leading one moved down past the two after it', () => {
    // An agent's run ended, and its card went from Working to Needs you.
    const after = ['$b', '$c', '$d', '$a', '$e', '$f'];
    expect(rowToPin(before, after, ['$a', '$b', '$c', '$d'])).toBe('$b');
    // To the end of the list, past every row in view.
    expect(rowToPin(before, ['$b', '$c', '$d', '$e', '$f', '$a'], ['$a', '$b'])).toBe('$b');
  });

  it('passes over a row that left the list, and one the list does not hold', () => {
    expect(rowToPin(before, ['$f', '$b', '$c', '$d', '$e'], ['$a', '$b', '$c'])).toBe('$b');
    expect(rowToPin(before, ['$f', '$a', '$b', '$c', '$d', '$e'], ['$pinned', '$a'])).toBe('$a');
    expect(rowToPin(before, ['$f', '$a', '$b', '$c', '$d', '$e'], [])).toBeUndefined();
  });
});

describe('rowsMovedUp', () => {
  const before = ['$a', '$b', '$c', '$d', '$e', '$f'];

  it('names the rows that stood after the pinned row and stand before it now', () => {
    expect(rowsMovedUp(before, ['$f', '$a', '$b', '$c', '$d', '$e'], '$b')).toEqual(['$f']);
    expect(rowsMovedUp(before, ['$b', '$a', '$c', '$d', '$e', '$f'], '$a')).toEqual(['$b']);
    expect(rowsMovedUp(before, ['$e', '$d', '$c', '$a', '$b', '$f'], '$a')).toEqual([
      '$e',
      '$d',
      '$c',
    ]);
  });

  it('leaves to React the rows that end up after the pinned row, and those that stood before it', () => {
    // $d moved up to right under the pinned $b, and $a went down past it.
    expect(rowsMovedUp(before, ['$b', '$d', '$a', '$c', '$e', '$f'], '$b')).toEqual([]);
    // $a moved up above $b from above it, and a card joined.
    expect(rowsMovedUp(['$x', '$a', '$b'], ['$new', '$a', '$x', '$b'], '$b')).toEqual([]);
    // The pinned row is gone, or was never there.
    expect(rowsMovedUp(before, ['$f', '$a', '$c'], '$b')).toEqual([]);
    expect(rowsMovedUp(before, ['$f', '$a', '$b'], '$new')).toEqual([]);
    expect(rowsMovedUp(before, ['$f', '$a', '$b'], undefined)).toEqual([]);
  });

  it('keeps the pinned row in the page for every order of six rows and every pin', () => {
    const orders = (rows: string[]): string[][] =>
      rows.length < 2
        ? [rows]
        : rows.flatMap((row) =>
            orders(rows.filter((other) => other !== row)).map((rest) => [row, ...rest])
          );
    orders(before).forEach((after) =>
      before.forEach((pin) => {
        const named = new Set(rowsMovedUp(before, after, pin));
        expect(named.has(pin)).toBe(false);
        // React, as it places keyed children: it keeps a row in the page unless one that it kept,
        // under the same key, stood after it.
        let last = -1;
        const kept = after.filter((row) => {
          if (named.has(row) || before.indexOf(row) < last) return false;
          last = before.indexOf(row);
          return true;
        });
        expect(kept, `${after.join(' ')} with ${pin} pinned`).toContain(pin);
      })
    );
  });
});

describe('useRowKeys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A list scrolled by `scrollTop` whose view the card of $a leads, cut at its top edge. */
  const keysOf = (scrollTop: number) => {
    const element = Object.assign(document.createElement('div'), { scrollTop });
    const lead = element.appendChild(document.createElement('div'));
    lead.setAttribute('data-scroll-anchor', '$a');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 600 } as DOMRect);
    vi.spyOn(lead, 'getBoundingClientRect').mockReturnValue({ top: -30, bottom: 56 } as DOMRect);
    const view = { current: element };
    const { result, rerender } = renderHook(({ rows }) => useRowKeys(rows, view), {
      initialProps: { rows: ['$a', '$b', '$c', '$d'] },
    });
    const keys = (rows: string[]) => {
      rerender({ rows });
      return rows.map(result.current);
    };
    return { keys, view };
  };

  it('gives a row that moved up past the leading row a new key, and its first key the next time', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const { keys } = keysOf(700);
    expect(keys(['$d', '$a', '$b', '$c'])).toEqual(['$d#', '$a', '$b', '$c']);
    // The same order again, and a card that joins: every row keeps its key.
    expect(keys(['$d', '$a', '$b', '$c'])).toEqual(['$d#', '$a', '$b', '$c']);
    expect(keys(['$e', '$d', '$a', '$b', '$c'])).toEqual(['$e', '$d#', '$a', '$b', '$c']);
    expect(keys(['$c', '$e', '$d', '$a', '$b'])).toEqual(['$c#', '$e', '$d#', '$a', '$b']);
    // Rows above the leading one that change places among themselves, and one that goes down
    // past it, keep their keys: React moves those.
    expect(keys(['$d', '$c', '$e', '$a', '$b'])).toEqual(['$d#', '$c#', '$e', '$a', '$b']);
    expect(keys(['$c', '$e', '$a', '$b', '$d'])).toEqual(['$c#', '$e', '$a', '$b', '$d#']);
    expect(keys(['$d', '$c', '$e', '$a', '$b'])).toEqual(['$d', '$c#', '$e', '$a', '$b']);
  });

  it('keeps every key at the top of the list', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const { keys, view } = keysOf(0);
    expect(keys(['$d', '$a', '$b', '$c'])).toEqual(['$d', '$a', '$b', '$c']);
    // Scrolled since: only a row that moves from now on takes a new key.
    view.current.scrollTop = 300;
    expect(keys(['$d', '$a', '$b', '$c'])).toEqual(['$d', '$a', '$b', '$c']);
    expect(keys(['$c', '$d', '$a', '$b'])).toEqual(['$c#', '$d', '$a', '$b']);
  });

  it('keeps every key in a browser without scroll anchoring, where the list scrolls itself', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property !== 'overflow-anchor' });
    const { keys } = keysOf(700);
    expect(keys(['$d', '$a', '$b', '$c'])).toEqual(['$d', '$a', '$b', '$c']);
  });
});

describe('useHeldThreadOrder', () => {
  it('follows the live order while nothing holds it', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c'], held: false },
    });
    rerender({ ids: ['$c', '$a', '$b'], held: false });
    expect(result.current).toEqual(['$c', '$a', '$b']);
  });

  it('keeps the shown order while held, drops threads that leave, adds new ones at the live end', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c', '$d'], held: false },
    });
    rerender({ ids: ['$a', '$b', '$c', '$d'], held: true });
    // $d got a reply and $b was resolved away; $e is new and leads the newest-first order.
    rerender({ ids: ['$e', '$d', '$a', '$c'], held: true });
    expect(result.current).toEqual(['$e', '$a', '$c', '$d']);
    // Still held: the next update keeps that order.
    rerender({ ids: ['$c', '$e', '$d', '$a'], held: true });
    expect(result.current).toEqual(['$e', '$a', '$c', '$d']);
    // Released: the live order applies.
    rerender({ ids: ['$c', '$e', '$d', '$a'], held: false });
    expect(result.current).toEqual(['$c', '$e', '$d', '$a']);
  });

  it('puts new threads at the top of a newest-first list, in their live order', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$c', '$b', '$a'], held: true },
    });
    rerender({ ids: ['$e', '$d', '$c', '$b', '$a'], held: true });
    expect(result.current).toEqual(['$e', '$d', '$c', '$b', '$a']);
  });

  it('puts new threads at the bottom of an oldest-first list', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c'], held: true },
    });
    // $a got a reply, which would move it to the bottom; $d is new.
    rerender({ ids: ['$b', '$c', '$a', '$d'], held: true });
    expect(result.current).toEqual(['$a', '$b', '$c', '$d']);
  });

  it('puts a new thread after the thread the live order puts before it', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c'], held: true },
    });
    // An older page brought $x, whose last reply falls between $b and $c.
    rerender({ ids: ['$a', '$b', '$x', '$c'], held: true });
    expect(result.current).toEqual(['$a', '$b', '$x', '$c']);
  });
});

describe('useHeldThreadOrder scrolling', () => {
  const CARD = 100;

  /** A list scrolled `scrollTop` down, its cards `CARD` px tall in the order `ids`. */
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
    const show = (shownIds: string[]) =>
      view.replaceChildren(
        ...shownIds.map((id) => {
          const card = document.createElement('div');
          card.setAttribute('data-scroll-anchor', id);
          card.getBoundingClientRect = () => {
            const top = [...view.children].indexOf(card) * CARD - offset;
            return { top, bottom: top + CARD } as DOMRect;
          };
          return card;
        })
      );
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
      ({ live }) => useHeldThreadOrder(live, true, { current: view }),
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
      ({ live }) => useHeldThreadOrder(live, true, { current: view }),
      { initialProps: { live: ids } }
    );
    show(['$d', ...ids]);
    rerender({ live: ['$d', ...ids] });
    expect(view.scrollTop).toBe(250);
  });

  it('keeps the cards in view in place when a card joins above them while nothing holds the order', () => {
    withoutScrollAnchoring();
    const ids = ['$c', '$b', '$a'];
    const { view, show } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useHeldThreadOrder(live, false, { current: view }),
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
      ({ live }) => useHeldThreadOrder(live, false, { current: view }),
      { initialProps: { live: ids } }
    );
    // $c, topmost in view, got a reply and leads the live order.
    const live = ['$c', '$a', '$b', '$d', '$e', '$f'];
    show(live);
    rerender({ live });
    expect(writes).toEqual([]);
    expect(view.scrollTop).toBe(250);
  });

  it("does not move the list on top of another script's scroll, such as the list reopening on a card", () => {
    withoutScrollAnchoring();
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useHeldThreadOrder(live, false, { current: view }),
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

  it("leaves the cards in view to the browser's scroll anchoring where it has one", () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = ['$c', '$b', '$a'];
    const { view, show, writes } = list(ids, 150);
    const { rerender } = renderHook(
      ({ live }) => useHeldThreadOrder(live, true, { current: view }),
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
