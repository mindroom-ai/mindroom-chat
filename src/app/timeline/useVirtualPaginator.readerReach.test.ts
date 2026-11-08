// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator, type ItemRange } from './useVirtualPaginator';

const observerState = vi.hoisted(() => ({
  report: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
  getOptions: undefined as (() => IntersectionObserverInit | undefined) | undefined,
}));

vi.mock('../lib/hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: (
    report: (entries: IntersectionObserverEntry[]) => void,
    getOptions?: () => IntersectionObserverInit | undefined
  ) => {
    observerState.report = report;
    observerState.getOptions = getOptions;
    return { observe: vi.fn(), unobserve: vi.fn() };
  },
}));

const rectAt = (top: number) => ({ top, bottom: top + 1, height: 1 } as DOMRect);

/**
 * A scroll area 600px tall under an 80px header and above a 120px composer, and its back sentinel
 * at `sentinelTop()`: the reader sees 80 to 480, and a screen beyond that reaches -520 to 1080.
 */
const setUp = (sentinelTop: () => number) => {
  const root = document.createElement('div');
  root.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 } as DOMRect);
  Object.defineProperty(root, 'clientHeight', { value: 600 });
  const sentinel = document.createElement('span');
  sentinel.getBoundingClientRect = () => rectAt(sentinelTop());
  root.append(sentinel);
  document.body.append(root);
  vi.stubGlobal('getComputedStyle', () => ({
    scrollPaddingTop: '80px',
    scrollPaddingBottom: '120px',
  }));
  return { root, sentinel };
};

type HarnessProps = { root: HTMLElement; range: ItemRange; onEnd: (back: boolean) => void };

function Harness({ root, range, onEnd }: HarnessProps) {
  const paginator = useVirtualPaginator({
    count: range.end,
    limit: 20,
    range,
    onRangeChange: () => undefined,
    getScrollElement: () => root,
    getItemElement: () => undefined,
    onEnd,
  });
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

const render = (props: HarnessProps, sentinel: HTMLElement): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(Harness, props), { createNodeMock: () => sentinel });
  });
  if (!renderer) throw new Error('not rendered');
  return renderer;
};

const reportShown = (sentinel: HTMLElement) =>
  act(() => {
    observerState.report?.([
      { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
    ]);
  });

describe('useVirtualPaginator reaches a screen beyond the reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('observes a screen beyond the scroll area', () => {
    const { root, sentinel } = setUp(() => -300);
    render({ root, range: { start: 0, end: 20 }, onEnd: vi.fn() }, sentinel);
    expect(observerState.getOptions?.()).toEqual({ root, rootMargin: '100% 0px' });
  });

  it('loads history before the reader reaches the sentinel', () => {
    const { root, sentinel } = setUp(() => -300);
    const onEnd = vi.fn();
    render({ root, range: { start: 0, end: 20 }, onEnd }, sentinel);
    reportShown(sentinel);
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('waits for a sentinel more than a screen away until scrolling brings it within reach', () => {
    let top = -560;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    render({ root, range: { start: 0, end: 20 }, onEnd }, sentinel);
    reportShown(sentinel);
    expect(onEnd).not.toHaveBeenCalled();

    top = -500;
    act(() => {
      root.dispatchEvent(new Event('scroll'));
    });
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('keeps paging while the pages add less than a screen of rows', () => {
    let top = -300;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    const renderer = render({ root, range: { start: 0, end: 20 }, onEnd }, sentinel);
    reportShown(sentinel);
    expect(onEnd).toHaveBeenCalledTimes(1);

    // A page of five rows lands: the sentinel is still within a screen, so the next page loads
    // without the reader scrolling.
    act(() => {
      renderer.update(React.createElement(Harness, { root, range: { start: 0, end: 25 }, onEnd }));
    });
    expect(onEnd).toHaveBeenCalledTimes(2);

    // A page of more than a screen of rows lands: paging stops until the reader scrolls on.
    top = -700;
    act(() => {
      renderer.update(React.createElement(Harness, { root, range: { start: 0, end: 60 }, onEnd }));
    });
    expect(onEnd).toHaveBeenCalledTimes(2);
  });
});
