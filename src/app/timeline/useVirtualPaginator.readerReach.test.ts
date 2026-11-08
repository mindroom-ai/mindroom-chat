// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator, type ItemRange } from './useVirtualPaginator';

const observerState = vi.hoisted(() => ({
  report: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
}));

vi.mock('../lib/hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: (report: (entries: IntersectionObserverEntry[]) => void) => {
    observerState.report = report;
    return { observe: vi.fn(), unobserve: vi.fn() };
  },
}));

/**
 * A scroll area 600px tall under an 80px header and above a 120px composer, and its back sentinel
 * at `sentinelTop()`: the reader sees 80 to 480, and a screen beyond that reaches -520 to 1080.
 */
const setUp = (sentinelTop: () => number) => {
  const root = document.createElement('div');
  root.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 } as DOMRect);
  Object.defineProperty(root, 'clientHeight', { value: 600 });
  const sentinel = document.createElement('span');
  sentinel.getBoundingClientRect = () => {
    const top = sentinelTop();
    return { top, bottom: top + 1, height: 1 } as DOMRect;
  };
  root.append(sentinel);
  document.body.append(root);
  vi.stubGlobal('getComputedStyle', () => ({
    scrollPaddingTop: '80px',
    scrollPaddingBottom: '120px',
  }));
  return { root, sentinel };
};

type Harness = {
  paginator?: ReturnType<typeof useVirtualPaginator>;
  setRange?: (range: ItemRange) => void;
};

function PaginatorHarness({
  root,
  initialRange,
  onRange,
  onEnd,
  harness,
}: {
  root: HTMLElement;
  initialRange: ItemRange;
  onRange: (range: ItemRange) => void;
  onEnd: (back: boolean) => void;
  harness: Harness;
}) {
  const [range, setRange] = React.useState<ItemRange>(initialRange);
  const paginator = useVirtualPaginator({
    count: 100,
    limit: 20,
    range,
    onRangeChange: (next) => {
      onRange(next);
      setRange(next);
    },
    getScrollElement: () => root,
    getItemElement: () => undefined,
    onEnd,
  });
  Object.assign(harness, { paginator, setRange });
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

/** `onStep` runs as the window moves, before it renders: it places the rows the step mounted. */
const render = (
  root: HTMLElement,
  sentinel: HTMLElement,
  initialRange: ItemRange,
  onStep?: (range: ItemRange) => void
) => {
  const harness: Harness = {};
  const onRange = vi.fn(onStep);
  const onEnd = vi.fn();
  act(() => {
    create(React.createElement(PaginatorHarness, { root, initialRange, onRange, onEnd, harness }), {
      createNodeMock: () => sentinel,
    });
  });
  return { harness, onRange, onEnd };
};

describe('useVirtualPaginator pages a screen ahead once paging runs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('keeps widening the window while each step adds less than a screen of rows', () => {
    let top = 100;
    const { root, sentinel } = setUp(() => top);
    // The first step's rows leave the sentinel out of view, but within a screen; the second's
    // leave it more than a screen away.
    const { onRange } = render(root, sentinel, { start: 60, end: 80 }, ({ start }) => {
      top = start === 40 ? -300 : -700;
    });
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });
    // Two steps: the reader saw the sentinel, then the first step left it within a screen.
    expect(onRange.mock.calls).toEqual([[{ start: 40, end: 80 }], [{ start: 20, end: 80 }]]);
  });

  it('stops once a step leaves the sentinel more than a screen away', () => {
    let top = 100;
    const { root, sentinel } = setUp(() => top);
    const { onRange } = render(root, sentinel, { start: 60, end: 80 }, () => {
      top = -700;
    });
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });
    expect(onRange.mock.calls).toEqual([[{ start: 40, end: 80 }]]);
  });

  it('looks at the visible band only after a window it did not plan', () => {
    const { root, sentinel } = setUp(() => -300);
    const { harness, onRange, onEnd } = render(root, sentinel, { start: 60, end: 80 });
    act(() => harness.setRange?.({ start: 50, end: 80 }));
    expect(onRange).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('asked to look ahead after a page with rows, loads the next page', () => {
    const { root, sentinel } = setUp(() => -300);
    const { harness, onEnd } = render(root, sentinel, { start: 0, end: 20 });
    act(() => harness.paginator?.retryPagination());
    expect(onEnd).not.toHaveBeenCalled();
    act(() => harness.paginator?.retryPagination({ ahead: true }));
    expect(onEnd.mock.calls).toEqual([[true]]);
  });
});
