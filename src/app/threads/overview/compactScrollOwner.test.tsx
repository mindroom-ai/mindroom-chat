// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CompactScrollRequest,
  MOUNT_REQUEST,
  useCompactScrollOwner,
} from './compactScrollOwner';

const CARD = 100;
const HEADER = 30;
const sectionOfRow = (id: string) => (id.startsWith('#') ? id : undefined);
const focus = { id: 'first', scrollTop: 1, anchors: [{ key: '$target', offset: 25 }] };

const list = (
  ids: string[],
  initialOffset: number,
  initialRequest?: CompactScrollRequest,
  staging = false
) => {
  let resizeCallback: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect() {
        resizeCallback = undefined;
      }
    }
  );
  let offset = initialOffset;
  let inset = 0;
  const writes: number[] = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const parent = this.parentElement;
    const start =
      this.hasAttribute('data-scroll-anchor') && parent
        ? Array.from(parent.children)
            .slice(0, Array.from(parent.children).indexOf(this))
            .reduce(
              (top, row) => top + (row.hasAttribute('data-scroll-anchor') ? CARD : HEADER),
              inset - offset
            )
        : 0;
    return {
      top: start,
      bottom: start + (this.hasAttribute('data-scroll-anchor') ? CARD : 400),
    } as DOMRect;
  });
  const ref = (element: HTMLDivElement | null) => {
    if (element)
      Object.defineProperty(element, 'scrollTop', {
        get: () => offset,
        set: (top: number) => {
          writes.push(top);
          offset = top;
        },
      });
  };
  function List({
    rows,
    pending,
    request,
  }: {
    rows: string[];
    pending: boolean;
    request: CompactScrollRequest | undefined;
  }) {
    const viewRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const phase = useCompactScrollOwner({
      viewRef,
      contentRef,
      rows,
      sectionOfRow,
      request,
      ready: rows.length > 0,
      memory: saved,
      roomId: 'room',
    });
    const attachView = useCallback((element: HTMLDivElement | null) => {
      viewRef.current = element;
      ref(element);
    }, []);
    return (
      <>
        <div ref={attachView} data-cards-pending={pending || undefined}>
          <div ref={contentRef}>
            {rows.map((id) => (
              <div key={id} data-scroll-anchor={sectionOfRow(id) ? undefined : id} />
            ))}
          </div>
        </div>
        {phase}
      </>
    );
  }
  const saved = new Map();
  const result = render(<List rows={ids} request={initialRequest} pending={staging} />);
  const view = result.container.firstElementChild as HTMLDivElement;
  return {
    view,
    show: (rows: string[], pending = false, request = initialRequest) =>
      result.rerender(<List rows={rows} request={request} pending={pending} />),
    writes,
    scrollBy: (delta: number) => {
      offset += delta;
    },
    /** Late layout: the browser tells the observer, in no commit. */
    resize: () => resizeCallback?.(),
    setInset: (px: number) => {
      inset = px;
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const withoutScrollAnchoring = () => vi.stubGlobal('CSS', { supports: () => false });

describe('Compact scroll owner', () => {
  it("does not undo the reader's scroll that a render sees before its scroll event", () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes, scrollBy } = list(ids, 150);

    scrollBy(100);
    // An index refresh renders the same threads before the scroll event fires.
    show([...ids]);
    expect(view.scrollTop).toBe(250);
    expect(writes).toEqual([]);
  });

  it('keeps the cards in view in place when a card joins above them, without scroll anchoring', () => {
    withoutScrollAnchoring();
    const ids = ['$c', '$b', '$a'];
    const { view, show } = list(ids, 150);

    show(['$d', ...ids]);
    expect(view.scrollTop).toBe(250);
  });

  it('keeps its place when the topmost card in view moves to the top, by the card after it', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes } = list(ids, 250);

    // $c, topmost in view, got a reply and leads the live order.
    const live = ['$c', '$a', '$b', '$d', '$e', '$f'];
    show(live);
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

    const top = topOf();
    show(live);
    expect(writes).toEqual([150]);
    expect(topOf()).toBe(top);
  });

  it('anchors the topmost card when the card just above moves down into a new section', () => {
    withoutScrollAnchoring();
    const later = ['#later', '$c', '$d', '$e', '$f'];
    const ids = ['#needsYou', '$a', '$b', ...later];
    const { view, show, writes } = list(ids, HEADER + CARD + 10);
    const topOfB = () =>
      view.querySelector('[data-scroll-anchor="$b"]')!.getBoundingClientRect().top;

    expect(topOfB()).toBe(-10);

    // A and B swap relative order, but only A changed sections. B should still anchor.
    const order = ['#needsYou', '$b', '#working', '$a', ...later];
    show(order);
    expect(topOfB()).toBe(-10);
    expect(writes).toEqual([HEADER + 10]);
  });

  it("corrects from the reader's new place once the scroll event has fired", () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, scrollBy, writes } = list(ids, 150);
    scrollBy(100);
    fireEvent.scroll(view);
    show(['$new', ...ids]);
    expect(writes).toEqual([350]);
  });

  it('keeps the cards in place across a layout shift that came between commits', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { show, setInset, writes } = list(ids, 150);
    // The header grows before the next render, which finds the cards already lower.
    setInset(80);
    show([...ids]);
    expect(writes).toEqual([230]);
  });

  it('keeps the cards in place again once a place without cards is reached', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    const { view, show, writes } = list(ids, 0, { id: MOUNT_REQUEST, scrollTop: 150, anchors: [] });
    expect(writes).toEqual([150]);
    fireEvent.scroll(view);
    show(['$new', ...ids]);
    expect(writes).toEqual([150, 250]);
  });

  it("leaves the cards in view to the browser's scroll anchoring where it has one", () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = ['$c', '$b', '$a'];
    const { show, writes } = list(ids, 150);

    show(['$d', ...ids]);
    expect(writes).toEqual([]);
  });

  it('consumes a placement token only once, even if a newer token came and went', () => {
    const ids = ['$a', '$b', '$target'];
    const { show, view, writes } = list(ids, 0, focus);
    expect(writes).toEqual([175]);
    show(ids, false, { ...focus, id: 'next', anchors: [{ key: '$b', offset: 25 }] });
    expect(view.scrollTop).toBe(75);
    show(ids);
    expect(writes).toEqual([175, 75]);
  });

  it("uses up the room's saved place with the first request the list takes", () => {
    const ids = ['$a', '$b', '$target'];
    const { show, writes } = list(ids, 0, focus);
    show(ids, false, { id: MOUNT_REQUEST, scrollTop: 50, anchors: [] });
    expect(writes).toEqual([175]);
  });

  it('places a target that stages late, as each chunk resizes the list', () => {
    const { view, show, resize } = list(['$a'], 0, focus, true);
    expect(view.scrollTop).toBe(1);
    show(['$a', '$target'], true);
    resize();
    expect(view.scrollTop).toBe(75);
    show(['$a', '$b', '$target']);
    resize();
    expect(view.scrollTop).toBe(175);
  });

  it('ends a pending placement when the reader scrolls', () => {
    const { view, show, scrollBy, resize } = list(['$a'], 0, focus, true);
    scrollBy(30);
    fireEvent.scroll(view);
    show(['$a', '$b', '$target']);
    resize();
    expect(view.scrollTop).toBe(31);
  });

  it('follows a late top inset resize after placing a mounted card without staging', () => {
    const { view, setInset, resize } = list(['$a', '$b', '$target'], 0, focus);
    expect(view.scrollTop).toBe(175);
    setInset(86);
    resize();
    expect(view.scrollTop).toBe(261);
  });

  it('keeps a focused card in place when threads arrive above it after mount', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const { view, show, resize } = list(['$a', '$target'], 0, focus);
    expect(view.scrollTop).toBe(75);
    show(['$x', '$y', '$z', '$a', '$target']);
    resize();
    expect(view.scrollTop).toBe(375);
  });

  it('ends a placement the first phase moved on from, when a card sorts above the view', () => {
    withoutScrollAnchoring();
    const ids = ['$a', '$b', '$c', '$d', '$e'];
    const saved = { id: MOUNT_REQUEST, scrollTop: 150, anchors: [{ key: '$c', offset: 50 }] };
    const { view, show, resize, setInset } = list(ids, 0, saved);
    expect(view.scrollTop).toBe(150);
    fireEvent.scroll(view);

    // $e sorts to the top: the cards in view are kept, so $c stays 50 below the top.
    show(['$e', '$a', '$b', '$c', '$d']);
    expect(view.scrollTop).toBe(250);
    // The placement ended there: late layout no longer moves the list.
    setInset(40);
    resize();
    expect(view.scrollTop).toBe(250);
  });

  it('does not chase a focused card that later reorders to the top', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const { view, show, resize } = list(['$a', '$b', '$target'], 0, focus);
    expect(view.scrollTop).toBe(175);
    show(['$target', '$a', '$b']);
    resize();
    expect(view.scrollTop).toBe(175);
  });
});
