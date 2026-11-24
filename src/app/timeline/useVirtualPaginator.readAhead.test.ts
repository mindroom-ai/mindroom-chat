// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator } from './useVirtualPaginator';

const observerState = vi.hoisted(() => ({
  report: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
  options: undefined as (() => IntersectionObserverInit | undefined) | undefined,
}));

vi.mock('../lib/hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: (
    report: (entries: IntersectionObserverEntry[]) => void,
    options?: () => IntersectionObserverInit | undefined
  ) => {
    observerState.report = report;
    observerState.options = options;
    return { observe: vi.fn(), unobserve: vi.fn() };
  },
}));

const boxRect = (top: number, height: number) => ({ top, bottom: top + height, height } as DOMRect);

/**
 * A scroll area 600px tall under an 80px header and above a 120px composer, and its back sentinel
 * at `sentinelTop()`: a screen beyond the scroll area reaches from -600 to 1200.
 */
const setUp = (sentinelTop: () => number) => {
  const root = document.createElement('div');
  root.getBoundingClientRect = () => boxRect(0, 600);
  const sentinel = document.createElement('span');
  sentinel.getBoundingClientRect = () => boxRect(sentinelTop(), 1);
  root.append(sentinel);
  document.body.append(root);
  vi.stubGlobal('getComputedStyle', () => ({
    scrollPaddingTop: '80px',
    scrollPaddingBottom: '120px',
  }));
  return { root, sentinel };
};

type HarnessProps = {
  root: HTMLElement;
  readAhead?: boolean;
  onEnd: (back: boolean) => void;
  suppress?: () => boolean;
  defer?: (retry: () => boolean) => boolean;
  onPaginator?: (paginator: ReturnType<typeof useVirtualPaginator>) => void;
};

function Harness({ root, onEnd, suppress, defer, onPaginator, readAhead = true }: HarnessProps) {
  const paginator = useVirtualPaginator({
    count: 20,
    limit: 20,
    range: { start: 0, end: 20 },
    onRangeChange: () => undefined,
    getScrollElement: () => root,
    getItemElement: () => undefined,
    onEnd,
    shouldSuppressPagination: suppress,
    deferAutomaticPagination: defer,
    readAhead,
  });
  onPaginator?.(paginator);
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

const render = (props: HarnessProps, sentinel: HTMLElement) =>
  act(() => {
    create(React.createElement(Harness, props), { createNodeMock: () => sentinel });
  });

const reportShown = (sentinel: HTMLElement) =>
  act(() => {
    observerState.report?.([
      { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
    ]);
  });

const scroll = (root: HTMLElement) =>
  act(() => {
    root.dispatchEvent(new Event('scroll'));
  });

describe('useVirtualPaginator pages a screen ahead of the reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('observes the sentinels up to a screen beyond the scroll area', () => {
    const { root, sentinel } = setUp(() => -300);
    render({ root, onEnd: vi.fn() }, sentinel);
    expect(observerState.options?.()).toEqual({ root, rootMargin: '100% 0px' });
  });

  it('without reading ahead, waits until a scroll shows a sentinel from under the header', () => {
    let top = 30;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    render({ root, onEnd, readAhead: false }, sentinel);
    expect(observerState.options?.()).toEqual({ root, rootMargin: undefined });
    reportShown(sentinel);
    expect(onEnd).not.toHaveBeenCalled();
    top = 80;
    scroll(root);
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('pages as soon as the observer reports a sentinel, under the header too', () => {
    const { root, sentinel } = setUp(() => 30);
    const onEnd = vi.fn();
    render({ root, onEnd }, sentinel);
    reportShown(sentinel);
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('looks again as the reader scrolls at a sentinel still within a screen', () => {
    let top = -300;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    let suppressed = true;
    render({ root, onEnd, suppress: () => suppressed }, sentinel);
    // A focus jump holds pagination when the observer reports the sentinel; it reports nothing
    // more while the sentinel stays within its reach.
    reportShown(sentinel);
    suppressed = false;
    expect(onEnd).not.toHaveBeenCalled();
    top = -650;
    scroll(root);
    expect(onEnd).not.toHaveBeenCalled();
    top = -500;
    scroll(root);
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('looks again at a turn of the wheel at the top, which scrolls nothing', () => {
    const { root, sentinel } = setUp(() => 0);
    const onEnd = vi.fn();
    let suppressed = true;
    render({ root, onEnd, suppress: () => suppressed }, sentinel);
    reportShown(sentinel);
    suppressed = false;
    act(() => {
      root.dispatchEvent(new Event('wheel', { bubbles: true }));
    });
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('looks again once the opening fill is over', () => {
    const { root, sentinel } = setUp(() => -300);
    const onEnd = vi.fn();
    let fillOver = false;
    const defer = () => !fillOver;
    render({ root, onEnd, defer }, sentinel);
    reportShown(sentinel);
    expect(onEnd).not.toHaveBeenCalled();
    fillOver = true;
    scroll(root);
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('hands the opening fill a retry that loads history up to a screen above the scroll area', () => {
    let top = -550;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    let retry: (() => boolean) | undefined;
    const defer = (next: () => boolean) => {
      retry = next;
      return true;
    };
    render({ root, onEnd, defer }, sentinel);
    let paginated: boolean | undefined;
    act(() => {
      paginated = retry?.();
    });
    expect(paginated).toBe(true);
    expect(onEnd.mock.calls).toEqual([[true]]);

    top = -650;
    act(() => {
      paginated = retry?.();
    });
    expect(paginated).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('retries towards a sentinel within a screen beyond the scroll area only', () => {
    let top = -650;
    const { root, sentinel } = setUp(() => top);
    const onEnd = vi.fn();
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;
    render(
      {
        root,
        onEnd,
        onPaginator: (next) => {
          paginator = next;
        },
      },
      sentinel
    );
    act(() => paginator?.retryPagination());
    expect(onEnd).not.toHaveBeenCalled();
    top = -550;
    act(() => paginator?.retryPagination());
    expect(onEnd.mock.calls).toEqual([[true]]);
  });
});

/** A window of 100 items that widens by 20 as the paginator asks, rendering what it is given. */
function SteppingHarness({
  root,
  onRange,
  onPaginator,
}: {
  root: HTMLElement;
  onRange: (range: { start: number; end: number }) => void;
  onPaginator: (paginator: ReturnType<typeof useVirtualPaginator>) => void;
}) {
  const [range, setRange] = React.useState({ start: 60, end: 80 });
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
    readAhead: true,
    externalBackwardScrollRestore: true,
  });
  onPaginator(paginator);
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

describe('useVirtualPaginator widens the window one step at a time', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('asked again before the widened window renders, waits for that render', () => {
    // The sentinel stays within a screen above the view: every step's render pages again.
    const { root, sentinel } = setUp(() => -300);
    const onRange = vi.fn();
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;
    act(() => {
      create(
        React.createElement(SteppingHarness, {
          root,
          onRange,
          onPaginator: (next) => {
            paginator = next;
          },
        }),
        { createNodeMock: () => sentinel }
      );
    });
    // A scroll and a size change look at the sentinel before the step renders.
    act(() => {
      paginator?.retryPagination();
      paginator?.retryPagination();
    });
    // Each window once: the owner prices the items a step mounts above the reader once.
    expect(onRange.mock.calls).toEqual([
      [{ start: 40, end: 80 }],
      [{ start: 20, end: 80 }],
      [{ start: 0, end: 80 }],
    ]);
  });
});
