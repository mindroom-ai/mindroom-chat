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

function Harness({ root, onEnd }: { root: HTMLElement; onEnd: (back: boolean) => void }) {
  const paginator = useVirtualPaginator({
    count: 20,
    limit: 20,
    range: { start: 0, end: 20 },
    onRangeChange: () => undefined,
    getScrollElement: () => root,
    getItemElement: () => undefined,
    onEnd,
  });
  return React.createElement('span', { ref: paginator.observeBackAnchor });
}

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
});
