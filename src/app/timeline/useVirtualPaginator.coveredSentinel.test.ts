// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator } from './useVirtualPaginator';

const observerState = vi.hoisted(() => ({
  report: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
}));

vi.mock('../lib/hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: (report: (entries: IntersectionObserverEntry[]) => void) => {
    observerState.report = report;
    return { observe: vi.fn(), unobserve: vi.fn() };
  },
}));

type Box = { top: number; height: number };
const boxRect = ({ top, height }: Box) => ({ top, bottom: top + height, height } as DOMRect);

/** A scroll area 600px tall under an 80px header and above a 120px composer. */
const makeScrollArea = () => {
  const root = document.createElement('div');
  root.getBoundingClientRect = () => boxRect({ top: 0, height: 600 });
  document.body.append(root);
  vi.stubGlobal('getComputedStyle', () => ({
    scrollPaddingTop: '80px',
    scrollPaddingBottom: '120px',
  }));
  return root;
};

type HarnessProps = {
  root: HTMLElement;
  onEnd: (back: boolean) => void;
  suppress?: () => boolean;
  defer?: (retry: () => boolean) => boolean;
  onPaginator?: (paginator: ReturnType<typeof useVirtualPaginator>) => void;
};

function Harness({ root, onEnd, suppress, defer, onPaginator }: HarnessProps) {
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
  });
  onPaginator?.(paginator);
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

/** The back sentinel in the scroll area, at `box`. */
const placeSentinel = (root: HTMLElement, box: () => Box) => {
  const sentinel = document.createElement('span');
  sentinel.getBoundingClientRect = () => boxRect(box());
  root.append(sentinel);
  return sentinel;
};

const reportShown = (sentinel: HTMLElement) =>
  act(() => {
    observerState.report?.([
      { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
    ]);
  });

describe('useVirtualPaginator sentinels under floating bars', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('waits until scrolling brings a sentinel out from under the header', () => {
    const root = makeScrollArea();
    const sentinel = document.createElement('span');
    let sentinelBox: Box = { top: 30, height: 1 };
    sentinel.getBoundingClientRect = () => boxRect(sentinelBox);
    const onEnd = vi.fn();
    act(() => {
      create(React.createElement(Harness, { root, onEnd }), {
        createNodeMock: () => sentinel,
      });
    });

    // In the scroll area's box, but under the header: the reader cannot see it.
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });
    expect(onEnd).not.toHaveBeenCalled();

    // A scroll that leaves it under the header changes nothing.
    sentinelBox = { top: 70, height: 1 };
    act(() => {
      root.dispatchEvent(new Event('scroll'));
    });
    expect(onEnd).not.toHaveBeenCalled();

    // The reader reaches the top: the sentinel shows below the header and history loads once.
    sentinelBox = { top: 80, height: 1 };
    act(() => {
      root.dispatchEvent(new Event('scroll'));
      root.dispatchEvent(new Event('scroll'));
    });
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('paginates at once when the sentinel shows between the bars', () => {
    const root = makeScrollArea();
    const sentinel = document.createElement('span');
    sentinel.getBoundingClientRect = () => boxRect({ top: 300, height: 1 });
    const onEnd = vi.fn();
    act(() => {
      create(React.createElement(Harness, { root, onEnd }), {
        createNodeMock: () => sentinel,
      });
    });
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('forgets a covered sentinel once it leaves the scroll area', () => {
    const root = makeScrollArea();
    const sentinel = document.createElement('span');
    let sentinelBox: Box = { top: 30, height: 1 };
    sentinel.getBoundingClientRect = () => boxRect(sentinelBox);
    const onEnd = vi.fn();
    act(() => {
      create(React.createElement(Harness, { root, onEnd }), {
        createNodeMock: () => sentinel,
      });
    });
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
      observerState.report?.([
        { target: sentinel, isIntersecting: false } as unknown as IntersectionObserverEntry,
      ]);
    });
    // Laid out in view again without the observer seeing it enter: nothing to recheck.
    sentinelBox = { top: 300, height: 1 };
    act(() => {
      root.dispatchEvent(new Event('scroll'));
    });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('pages once the reader scrolls up to a sentinel the opening fill left under the header', () => {
    const root = makeScrollArea();
    let sentinelBox: Box = { top: 300, height: 1 };
    const sentinel = placeSentinel(root, () => sentinelBox);
    const onEnd = vi.fn();
    // The fill holds pagination until its retry finds nothing more to load.
    let retry: (() => boolean) | undefined;
    let fillOver = false;
    const defer = (next: () => boolean) => {
      if (fillOver) return false;
      retry = next;
      return true;
    };
    act(() => {
      create(React.createElement(Harness, { root, onEnd, defer }), {
        createNodeMock: () => sentinel,
      });
    });

    // In view when the observer reports it, but the fill holds pagination...
    reportShown(sentinel);
    expect(onEnd).not.toHaveBeenCalled();
    // ...and its rows settle with the sentinel under the header, inside the scroll area: the
    // observer reports nothing more, and the fill finds nothing to load.
    sentinelBox = { top: 30, height: 1 };
    let retried: boolean | undefined;
    act(() => {
      retried = retry?.();
      fillOver = !retried;
    });
    expect(retried).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();

    // The reader scrolls up to the top: the sentinel shows below the header, history loads once.
    sentinelBox = { top: 80, height: 1 };
    act(() => {
      root.dispatchEvent(new Event('scroll'));
      root.dispatchEvent(new Event('scroll'));
    });
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('pages once the reader scrolls up to a sentinel a focus jump left under the header', () => {
    const root = makeScrollArea();
    let sentinelBox: Box = { top: 300, height: 1 };
    const sentinel = placeSentinel(root, () => sentinelBox);
    const onEnd = vi.fn();
    let suppressed = true;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;
    act(() => {
      create(
        React.createElement(Harness, {
          root,
          onEnd,
          suppress: () => suppressed,
          onPaginator: (next) => {
            paginator = next;
          },
        }),
        { createNodeMock: () => sentinel }
      );
    });

    // Reported in view during the jump, which holds pagination; the jump lands with the sentinel
    // under the header, and its retry finds nothing in view.
    reportShown(sentinel);
    sentinelBox = { top: 30, height: 1 };
    suppressed = false;
    act(() => paginator?.retryPagination());
    expect(onEnd).not.toHaveBeenCalled();

    sentinelBox = { top: 80, height: 1 };
    act(() => {
      root.dispatchEvent(new Event('scroll'));
    });
    expect(onEnd.mock.calls).toEqual([[true]]);
  });
});
