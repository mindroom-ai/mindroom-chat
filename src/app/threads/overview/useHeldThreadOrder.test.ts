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

const isHeader = (row: string) => row.startsWith('section:');

/** The rows React leaves in the page: all but those `renewed` and those it takes out to move. */
const rowsLeftInPage = (
  before: readonly string[],
  after: readonly string[],
  renewed: readonly string[]
) => {
  // As it places keyed children, React keeps a row in the page unless one that it kept, under
  // the same key, stood after it.
  let last = -1;
  return after.filter((row) => {
    if (renewed.includes(row) || before.indexOf(row) < last) return false;
    last = before.indexOf(row);
    return true;
  });
};

/**
 * How many rows the first row in view that stayed (none of `movers`) shows from its place after
 * the change, where the browser anchors the scroll: it keeps its place by the first row in view
 * that never left the page, and the list's offset stays when there is none.
 */
const shiftInView = (
  before: readonly string[],
  after: readonly string[],
  inView: readonly string[],
  movers: readonly string[]
): number => {
  const pin = rowToPin(before, after, inView, isHeader);
  const inPage = rowsLeftInPage(before, after, rowsMovedUp(before, after, pin, inView));
  const moved = (row?: string) => (row ? after.indexOf(row) - before.indexOf(row) : 0);
  const anchor = inView.find((row) => inPage.includes(row));
  const stayed = inView.find((row) => after.includes(row) && !movers.includes(row));
  return moved(stayed) - moved(anchor);
};

const moveTo = (rows: readonly string[], movers: readonly string[], place: number) => {
  const rest = rows.filter((row) => !movers.includes(row));
  return [...rest.slice(0, place), ...movers, ...rest.slice(place)];
};

/**
 * Every run of four rows, without the headers among them: the views of a list whose view holds
 * four. The browser anchors on cards only.
 */
const viewsOf = (rows: readonly string[]) =>
  rows.slice(3).map((_, at) => rows.slice(at, at + 4).filter((row) => !isHeader(row)));

describe('rowToPin', () => {
  const before = ['$a', '$b', '$c', '$d', '$e', '$f'];
  const pin = (after: string[], inView: string[]) => rowToPin(before, after, inView, isHeader);

  it('pins the row that leads the view when rows moved up past it', () => {
    expect(pin(['$f', '$a', '$b', '$c', '$d', '$e'], ['$b', '$c', '$d'])).toBe('$b');
    // A row in view moved up: the row above it still leads.
    expect(pin(['$d', '$a', '$b', '$c', '$e', '$f'], ['$b', '$c', '$d'])).toBe('$b');
    // The two rows right under the leading one moved to the top.
    expect(pin(['$e', '$d', '$a', '$b', '$c', '$f'], ['$c', '$d', '$e', '$f'])).toBe('$c');
    expect(pin(['$d', '$e', '$a', '$b', '$c', '$f'], ['$c', '$d', '$e', '$f'])).toBe('$c');
  });

  it('pins the next row in view that stayed when the leading one moved up', () => {
    // To the top of the list, as a reply moves it, and past one row only.
    expect(pin(['$c', '$a', '$b', '$d', '$e', '$f'], ['$c', '$d', '$e'])).toBe('$d');
    expect(pin(['$b', '$a', '$c', '$d', '$e', '$f'], ['$b', '$c', '$d'])).toBe('$c');
    // With the row under it, in either order, and with a card that joins.
    expect(pin(['$c', '$d', '$a', '$b', '$e', '$f'], ['$c', '$d', '$e'])).toBe('$e');
    expect(pin(['$d', '$c', '$a', '$b', '$e', '$f'], ['$c', '$d', '$e'])).toBe('$e');
    expect(pin(['$new', '$c', '$a', '$b', '$d', '$e', '$f'], ['$c', '$d', '$e'])).toBe('$d');
  });

  it('keeps the next card when the leading one went to the top, and the leading one when the two under it did', () => {
    const rows = Array.from({ length: 12 }, (_, index) => `$r${index}`);
    const inView = rows.slice(5, 9);
    const replied = moveTo(rows, ['$r5'], 0);
    expect(rowToPin(rows, replied, inView, isHeader)).toBe('$r6');
    expect(rowsMovedUp(rows, replied, '$r6', inView)).toEqual(['$r5']);
    const both = moveTo(rows, ['$r7', '$r6'], 0);
    expect(rowToPin(rows, both, inView, isHeader)).toBe('$r5');
    expect(rowsMovedUp(rows, both, '$r5', inView)).toEqual(['$r7', '$r6']);
  });

  it('pins the upper of two rows that swap', () => {
    expect(pin(['$b', '$a', '$c', '$d', '$e', '$f'], ['$a', '$b', '$c'])).toBe('$a');
  });

  it('pins the leading row when rows from under the next one came up past both', () => {
    // $c, $d and $e rotate above $a and $b, all five in view.
    expect(pin(['$c', '$d', '$e', '$a', '$b', '$f'], ['$a', '$b', '$c', '$d', '$e'])).toBe('$a');
  });

  it('pins the next row in view when the leading one moved down past the two after it', () => {
    // A thread was read, and its card went under the unread ones.
    expect(pin(['$b', '$c', '$d', '$a', '$e', '$f'], ['$a', '$b', '$c', '$d'])).toBe('$b');
    // To the end of the list, past every row in view.
    expect(pin(['$b', '$c', '$d', '$e', '$f', '$a'], ['$a', '$b'])).toBe('$b');
    // The rows it passed did not move up, so the next of them leads.
    expect(pin(['$a', '$c', '$d', '$e', '$b', '$f'], ['$c', '$d', '$e'])).toBe('$c');
  });

  it('takes a card that stands under another header as the one that moved', () => {
    const rows = ['section:working', '$a', '$b', 'section:needsYou', '$c', '$d', '$e'];
    const pinOf = (after: string[], inView: string[]) => rowToPin(rows, after, inView, isHeader);
    // An agent's run ended: its card, the last under Working, went to the top of Needs you, past
    // the header only.
    const ended = ['section:working', '$a', 'section:needsYou', '$b', '$c', '$d', '$e'];
    expect(pinOf(ended, ['$b', '$c', '$d'])).toBe('$c');
    expect(pinOf(ended, ['$a', '$b', '$c'])).toBe('$a');
    // Both runs ended at once, and the cards they passed stayed.
    const bothEnded = ['section:working', 'section:needsYou', '$b', '$a', '$c', '$d', '$e'];
    expect(pinOf(bothEnded, ['$b', '$c', '$d'])).toBe('$c');
    // Two cards went up to Working, and the one that leads Needs you now stayed.
    const asked = ['section:working', '$d', '$c', '$a', '$b', 'section:needsYou', '$e'];
    expect(pinOf(asked, ['$c', '$d', '$e'])).toBe('$e');
    expect(pinOf(asked, ['$a', '$b', '$c'])).toBe('$a');
    // The first run to end: its card went down under a header that came with it, past one card.
    const ran = ['section:working', '$a', '$b', 'section:done', '$c', '$d'];
    const first = ['section:working', '$b', 'section:needsYou', '$a', 'section:done', '$c', '$d'];
    expect(rowToPin(ran, first, ['$a', '$b', '$c'], isHeader)).toBe('$b');
  });

  it('passes over a row that left the list, and one the list does not hold', () => {
    expect(pin(['$f', '$b', '$c', '$d', '$e'], ['$a', '$b', '$c'])).toBe('$b');
    expect(pin(['$f', '$a', '$b', '$c', '$d', '$e'], ['$pinned', '$a'])).toBe('$a');
    expect(pin(['$f', '$a', '$b', '$c', '$d', '$e'], [])).toBeUndefined();
  });

  it('reads two rows that came up from right under a row to right above it as that row going down', () => {
    // The orders are the same; the two rows keep their places on screen, as without a pin.
    expect(pin(['$a', '$c', '$d', '$b', '$e', '$f'], ['$b', '$c', '$d'])).toBe('$c');
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

  it('names the rows in view that stood before the pinned row and still do', () => {
    // $c led the view and moved to the top: left in the page, the browser would follow it there.
    const after = ['$c', '$a', '$b', '$d', '$e', '$f'];
    expect(rowsMovedUp(before, after, '$d', ['$c', '$d', '$e'])).toEqual(['$c']);
    // Under the pinned row now, React takes it out by itself.
    expect(rowsMovedUp(before, ['$a', '$b', '$d', '$c', '$e', '$f'], '$d', ['$c', '$d'])).toEqual(
      []
    );
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

  const orders = (rows: string[]): string[][] =>
    rows.length < 2
      ? [rows]
      : rows.flatMap((row) =>
          orders(rows.filter((other) => other !== row)).map((rest) => [row, ...rest])
        );

  it('keeps the pinned row in the page for every order of six rows and every pin', () => {
    orders(before).forEach((after) =>
      before.forEach((pin) => {
        const named = rowsMovedUp(before, after, pin);
        expect(named).not.toContain(pin);
        expect(
          rowsLeftInPage(before, after, named),
          `${after.join(' ')} with ${pin} pinned`
        ).toContain(pin);
      })
    );
  });

  it('leaves the browser the pinned row to keep its place by, for every order of six rows and every view', () => {
    const views = before.flatMap((_, from) => before.slice(from).map((__, to) => [from, to]));
    orders(before).forEach((after) =>
      views.forEach(([from, length]) => {
        const inView = before.slice(from, (from ?? 0) + (length ?? 0) + 1);
        const pin = rowToPin(before, after, inView, isHeader);
        const named = rowsMovedUp(before, after, pin, inView);
        const inPage = rowsLeftInPage(before, after, named);
        // No row in view above the pinned one stays in the page, and without a pin every row
        // keeps its key.
        if (pin) expect(inView.find((row) => inPage.includes(row))).toBe(pin);
        else expect(named, `${after.join(' ')} seen from ${inView[0]}`).toEqual([]);
      })
    );
  });
});

describe('the rows in view through a change of order', () => {
  const rows = ['$0', '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8'];
  // A row moved up when it passed one: a row that stood before it stands after it now.
  const movedUp = (before: readonly string[], after: readonly string[], movers: string[]) =>
    movers.filter((mover) =>
      before
        .slice(0, before.indexOf(mover))
        .some((row) => after.indexOf(row) > after.indexOf(mover))
    );

  it('stay in place when one row moves, from any place to any other', () => {
    rows.forEach((mover, from) =>
      rows.forEach((_, to) => {
        // One place down is the next row's move one place up.
        if (to === from || to === from + 1) return;
        const after = moveTo(rows, [mover], to);
        viewsOf(rows).forEach((inView) =>
          expect(
            shiftInView(rows, after, inView, [mover]),
            `${mover} to ${to}, seen from ${inView[0]}`
          ).toBe(0)
        );
      })
    );
  });

  it('stay in place when one or two rows move to the top, with a card that joins or without', () => {
    rows.forEach((first) =>
      rows.forEach((second) =>
        [[], ['$new']].forEach((joined) => {
          // The first row's two followers came up past it in their order, which is also the
          // order of that row going down: see `rowToPin`.
          if (first === '$1' && second === '$2') return;
          const after = [...joined, ...moveTo(rows, [...new Set([first, second])], 0)];
          const movers = movedUp(rows, after, [first, second]);
          viewsOf(rows).forEach((inView) =>
            expect(
              shiftInView(rows, after, inView, movers),
              `${after.join(' ')} seen from ${inView[0]}`
            ).toBe(0)
          );
        })
      )
    );
  });

  // Sections with a few cards each, and with one that has none yet and one that has a single card:
  // a header comes with its first card and goes with its last.
  const layouts: Record<string, string[]>[] = [
    {
      'section:working': ['$w0', '$w1', '$w2'],
      'section:needsYou': ['$n0', '$n1', '$n2', '$n3'],
      'section:done': ['$d0', '$d1', '$d2', '$d3'],
    },
    {
      'section:working': ['$w0'],
      'section:needsYou': ['$n0', '$n1', '$n2'],
      'section:later': [],
      'section:done': ['$d0', '$d1', '$d2', '$d3'],
    },
  ];
  const rowsOf = (cards: Record<string, string[]>) =>
    Object.entries(cards).flatMap(([header, members]) =>
      members.length > 0 ? [header, ...members] : []
    );
  /** The cards with `card` at the top of the section under `header`, as a new run or reply puts it. */
  const toTopOf = (cards: Record<string, string[]>, card: string, header: string) =>
    Object.fromEntries(
      Object.entries(cards).map(([id, members]) => {
        const rest = members.filter((member) => member !== card);
        return [id, id === header ? [card, ...rest] : rest];
      })
    );

  it('stay in place in sections when a card goes to the top of any section, its own too', () => {
    layouts.forEach((sections) => {
      const before = rowsOf(sections);
      const cards = before.filter((row) => !isHeader(row));
      cards.forEach((card) =>
        Object.keys(sections).forEach((header) => {
          const after = rowsOf(toTopOf(sections, card, header));
          if (after.join() === before.join()) return;
          viewsOf(before).forEach((inView) =>
            expect(
              shiftInView(before, after, inView, [card]),
              `${after.join(' ')} seen from ${inView[0]}`
            ).toBe(0)
          );
        })
      );
    });
  });

  it('stay in place in sections when two cards go to the top of another section at once', () => {
    layouts.forEach((sections) => {
      const before = rowsOf(sections);
      const cards = before.filter((row) => !isHeader(row));
      cards.forEach((first) =>
        cards.forEach((second) =>
          Object.keys(sections).forEach((header) => {
            const members = sections[header] ?? [];
            if (first === second || members.includes(first) || members.includes(second)) return;
            const after = rowsOf(toTopOf(toTopOf(sections, first, header), second, header));
            viewsOf(before).forEach((inView) =>
              expect(
                shiftInView(before, after, inView, [first, second]),
                `${after.join(' ')} seen from ${inView[0]}`
              ).toBe(0)
            );
          })
        )
      );
    });
  });
});

describe('useRowKeys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * A list scrolled by `scrollTop` whose box the card of $a leads, cut at its top edge, over the
   * card of $b.
   */
  const keysOf = (scrollTop: number, movesUp = true) => {
    const element = Object.assign(document.createElement('div'), { scrollTop });
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 600 } as DOMRect);
    [
      ['$a', -30],
      ['$b', 60],
    ].forEach(([rootId, top]) => {
      const card = element.appendChild(document.createElement('div'));
      card.setAttribute('data-scroll-anchor', String(rootId));
      const box = { top: Number(top), bottom: Number(top) + 86 } as DOMRect;
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(box);
    });
    const view = { current: element };
    const useKeys = ({ rows }: { rows: string[] }) => useRowKeys(rows, view, isHeader, movesUp);
    const { result, rerender } = renderHook(useKeys, {
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

  it('takes the view inside its scroll padding, as the browser does, not the row under a bar', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    // $a and $b swap. $a leads the list's box and stays, so $b moved up past it.
    expect(keysOf(700).keys(['$b', '$a', '$c', '$d'])).toEqual(['$b#', '$a', '$c', '$d']);
    // Under a bar 60 px high $a is out of view: $b leads it and moved, and no row in view stayed.
    const padded = { scrollPaddingTop: '60px', getPropertyValue: () => '' };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(padded as unknown as CSSStyleDeclaration);
    expect(keysOf(700).keys(['$b', '$a', '$c', '$d'])).toEqual(['$b', '$a', '$c', '$d']);
  });

  it('keeps every key in a list where a reply moves its card down', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    expect(keysOf(700, false).keys(['$d', '$a', '$b', '$c'])).toEqual(['$d', '$a', '$b', '$c']);
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
