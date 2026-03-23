import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, useVirtualPaginator } from './useVirtualPaginator';

const intersectionState = vi.hoisted(() => ({
  callback: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
}));

vi.mock('./useIntersectionObserver', () => ({
  useIntersectionObserver: (callback: (entries: IntersectionObserverEntry[]) => void) => {
    intersectionState.callback = callback;
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
  },
}));

type HarnessProps = {
  onRangeChange: (range: { start: number; end: number }) => void;
  suppress: boolean;
};

const Harness = ({ onRangeChange, suppress }: HarnessProps) => {
  useVirtualPaginator({
    count: 100,
    limit: 10,
    range: { start: 10, end: 20 },
    onRangeChange,
    getScrollElement: () => null,
    getItemElement: () => undefined,
    shouldSuppressPagination: () => suppress,
  });

  return null;
};

const makeIntersectionEntry = (direction: Direction): IntersectionObserverEntry =>
  ({
    isIntersecting: true,
    target: {
      getAttribute: (attribute: string) =>
        attribute === 'data-paginator-anchor' ? direction : null,
    } as Element,
  } as IntersectionObserverEntry);

describe('useVirtualPaginator', () => {
  beforeEach(() => {
    intersectionState.callback = undefined;
  });

  it('suppresses observer-driven pagination while focus scrolling is active', () => {
    const onRangeChange = vi.fn();

    create(
      React.createElement(Harness, {
        onRangeChange,
        suppress: true,
      })
    );

    act(() => {
      intersectionState.callback?.([makeIntersectionEntry(Direction.Backward)]);
    });

    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it('still paginates once suppression is cleared', () => {
    const onRangeChange = vi.fn();

    create(
      React.createElement(Harness, {
        onRangeChange,
        suppress: false,
      })
    );

    act(() => {
      intersectionState.callback?.([makeIntersectionEntry(Direction.Backward)]);
    });

    expect(onRangeChange).toHaveBeenCalledWith({
      start: 0,
      end: 20,
    });
  });
});
