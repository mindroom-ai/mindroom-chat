// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator } from './useVirtualPaginator';

const observerState = vi.hoisted(() => ({
  report: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
}));

vi.mock('./useIntersectionObserver', () => ({
  useIntersectionObserver: (report: (entries: IntersectionObserverEntry[]) => void) => {
    observerState.report = report;
    return { observe: vi.fn(), unobserve: vi.fn() };
  },
}));

const rectAt = (top: number, height: number) => ({ top, bottom: top + height, height } as DOMRect);

/** A 600px scroll area under an 80px header and above a 120px composer, with its back sentinel. */
const setUp = (sentinelTop: number) => {
  const root = document.createElement('div');
  root.getBoundingClientRect = () => rectAt(0, 600);
  const sentinel = document.createElement('div');
  sentinel.getBoundingClientRect = () => rectAt(sentinelTop, 1);
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
  onEnd: (back: boolean) => void;
  defer?: (retry: () => boolean) => boolean;
  reach?: () => number;
};

function Harness({ root, onEnd, defer, reach }: HarnessProps) {
  const paginator = useVirtualPaginator({
    count: 20,
    limit: 20,
    range: { start: 0, end: 20 },
    onRangeChange: () => undefined,
    getScrollElement: () => root,
    getItemElement: () => undefined,
    onEnd,
    deferAutomaticPagination: defer,
    automaticBackReach: reach,
  });
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

const render = (props: HarnessProps, sentinel: HTMLElement) =>
  act(() => {
    create(React.createElement(Harness, props), { createNodeMock: () => sentinel });
  });

describe('useVirtualPaginator opening fill reach', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('hands the fill a retry at mount that loads history up to its reach above the view', () => {
    // Rows already reach 150px above the scroll area: the observer never sees the sentinel.
    const { root, sentinel } = setUp(-150);
    const onEnd = vi.fn();
    let retry: (() => boolean) | undefined;
    const defer = (next: () => boolean) => {
      retry = next;
      return true;
    };
    render({ root, onEnd, defer, reach: () => 600 }, sentinel);
    expect(retry).toBeDefined();
    expect(onEnd).not.toHaveBeenCalled();

    let paginated = false;
    act(() => {
      paginated = retry?.() ?? false;
    });
    expect(paginated).toBe(true);
    expect(onEnd.mock.calls).toEqual([[true]]);
  });

  it('stops once the history above the view is deeper than the reach', () => {
    const { root, sentinel } = setUp(-150);
    const onEnd = vi.fn();
    let retry: (() => boolean) | undefined;
    const defer = (next: () => boolean) => {
      retry = next;
      return true;
    };
    // The band starts at 80px; a 200px reach looks up to -120px, short of the sentinel.
    render({ root, onEnd, defer, reach: () => 200 }, sentinel);
    expect(retry?.()).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('without a reach, the fill counts only the band between the bars', () => {
    const { root, sentinel } = setUp(40);
    const onEnd = vi.fn();
    let retry: (() => boolean) | undefined;
    const defer = (next: () => boolean) => {
      retry = next;
      return true;
    };
    render({ root, onEnd, defer }, sentinel);
    expect(retry?.()).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a sentinel the reader scrolls under the header still waits once the fill is over', () => {
    const { root, sentinel } = setUp(40);
    const onEnd = vi.fn();
    render({ root, onEnd, defer: () => false, reach: () => 600 }, sentinel);
    act(() => {
      observerState.report?.([
        { target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });
    expect(onEnd).not.toHaveBeenCalled();
  });
});
