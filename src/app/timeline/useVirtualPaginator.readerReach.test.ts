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

type Harness = { setRange?: (range: ItemRange) => void };

function PaginatorHarness({
  root,
  onEnd,
  harness,
}: {
  root: HTMLElement;
  onEnd: (back: boolean) => void;
  harness: Harness;
}) {
  const [range, setRange] = React.useState<ItemRange>({ start: 0, end: 20 });
  const paginator = useVirtualPaginator({
    count: 100,
    limit: 20,
    range,
    onRangeChange: setRange,
    getScrollElement: () => root,
    getItemElement: () => undefined,
    onEnd,
  });
  Object.assign(harness, { setRange });
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

const render = (root: HTMLElement, sentinel: HTMLElement, onEnd: (back: boolean) => void) => {
  const harness: Harness = {};
  act(() => {
    create(React.createElement(PaginatorHarness, { root, onEnd, harness }), {
      createNodeMock: () => sentinel,
    });
  });
  return harness;
};

describe('useVirtualPaginator pages on a screen beyond the reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('keeps paging while the pages add less than a screen of rows', () => {
    let top = 100;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    const harness = render(root, sentinel, onEnd);
    // The reader sees the sentinel: history loads.
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);

    // The page lands with a few rows: the sentinel is out of view, but within a screen, so the next
    // page loads without the reader scrolling.
    top = -300;
    act(() => harness.setRange?.({ start: 0, end: 25 }));
    expect(onEnd).toHaveBeenCalledTimes(2);

    // That page lands with more than a screen of rows: paging waits for the reader.
    top = -700;
    act(() => harness.setRange?.({ start: 0, end: 60 }));
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('pages only on what the reader sees when rows change by themselves', () => {
    const { root, sentinel } = setUp(() => -300);
    const onEnd = vi.fn();
    const harness = render(root, sentinel, onEnd);
    act(() => harness.setRange?.({ start: 0, end: 21 }));
    expect(onEnd).not.toHaveBeenCalled();
  });
});
