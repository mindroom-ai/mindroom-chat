// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHeldThreadOrder, usePointerOverCards } from './useHeldThreadOrder';

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
