import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator } from './useVirtualPaginator';

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

type PaginatorHarnessProps = {
  count?: number;
  limit?: number;
  initialRange?: { start: number; end: number };
  getScrollElement: () => HTMLElement | null;
  getItemElement?: (
    index: number,
    range: {
      start: number;
      end: number;
    }
  ) => HTMLElement | undefined;
  onApi: (paginator: ReturnType<typeof useVirtualPaginator>) => void;
  onRangeChange?: (range: { start: number; end: number }) => void;
  shouldSuppressPagination?: () => boolean;
};

function PaginatorHarness({
  count = 100,
  limit = 10,
  initialRange = { start: 10, end: 20 },
  getScrollElement,
  getItemElement,
  onApi,
  onRangeChange,
  shouldSuppressPagination,
}: PaginatorHarnessProps) {
  const [range, setRange] = React.useState(initialRange);
  const paginator = useVirtualPaginator({
    count,
    limit,
    range,
    onRangeChange: (nextRange) => {
      onRangeChange?.(nextRange);
      setRange(nextRange);
    },
    getScrollElement,
    getItemElement: (index: number) => getItemElement?.(index, range),
    shouldSuppressPagination,
  });

  React.useLayoutEffect(() => {
    onApi(paginator);
  }, [onApi, paginator]);

  return null;
}

const makeRect = (top: number, height: number) => ({
  top,
  bottom: top + height,
  height,
});

describe('useVirtualPaginator', () => {
  beforeEach(() => {
    intersectionState.callback = undefined;
    vi.unstubAllGlobals();
  });

  it('retries visible-anchor pagination after suppression is cleared without needing a rerender', () => {
    const suppressRef = { current: true };
    const onRangeChange = vi.fn();
    const scrollElement = {
      offsetTop: 0,
      offsetHeight: 100,
      scrollHeight: 1000,
      scrollTop: 0,
      getBoundingClientRect: () => makeRect(0, 100),
      querySelector: (selector: string) =>
        selector.includes('"F"')
          ? ({
              getBoundingClientRect: () => makeRect(90, 10),
            } as HTMLElement)
          : null,
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
          onRangeChange,
          shouldSuppressPagination: () => suppressRef.current,
        })
      );
    });

    act(() => {
      paginator?.retryPagination();
    });

    expect(onRangeChange).not.toHaveBeenCalled();

    suppressRef.current = false;

    act(() => {
      paginator?.retryPagination();
    });

    expect(onRangeChange).toHaveBeenCalledWith({
      start: 10,
      end: 30,
    });
  });

  it('uses getBoundingClientRect deltas and a RAF correction in scrollToElement', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    let elementTop = 250;
    let scrollCalls = 0;
    const scrollElement = {
      getBoundingClientRect: () => ({
        ...makeRect(100, 200),
      }),
      scrollBy: vi.fn(({ top }: { top: number }) => {
        scrollCalls += 1;
        if (scrollCalls === 1) {
          elementTop -= top - 10;
          return;
        }
        elementTop -= top;
      }),
    } as unknown as HTMLElement;
    const targetElement = {
      getBoundingClientRect: () => ({
        ...makeRect(elementTop, 20),
      }),
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
        })
      );
    });

    act(() => {
      expect(
        paginator?.scrollToElement(targetElement, {
          align: 'center',
          behavior: 'instant',
        })
      ).toBe(true);
    });

    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(1, {
      top: 60,
      behavior: 'instant',
    });
    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(2, {
      top: 10,
      behavior: 'instant',
    });
  });

  it('skips RAF correction when scrolled to the top boundary', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    // Element is near the top and can't be centered because scrollTop is 0
    const scrollElement = {
      scrollTop: 0,
      scrollHeight: 300,
      clientHeight: 200,
      getBoundingClientRect: () => ({
        ...makeRect(100, 200),
      }),
      scrollBy: vi.fn(),
    } as unknown as HTMLElement;
    const targetElement = {
      getBoundingClientRect: () => ({
        // Element is at top of container — error would be negative (wants to scroll up)
        ...makeRect(110, 20),
      }),
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
        })
      );
    });

    act(() => {
      paginator?.scrollToElement(targetElement, {
        align: 'center',
        behavior: 'instant',
      });
    });

    // First scrollBy fires with a negative delta (wants to scroll up to center)
    expect(scrollElement.scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(1, {
      top: -80,
      behavior: 'instant',
    });
    // RAF correction should NOT fire because scrollTop=0 and error<0
  });

  it('skips RAF correction when scrolled to the bottom boundary', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    // Element is near the bottom and can't be centered because scrollTop is at max
    const scrollElement = {
      scrollTop: 100,
      scrollHeight: 300,
      clientHeight: 200,
      getBoundingClientRect: () => ({
        ...makeRect(100, 200),
      }),
      scrollBy: vi.fn(),
    } as unknown as HTMLElement;
    const targetElement = {
      getBoundingClientRect: () => ({
        // Element is at bottom of container — error would be positive (wants to scroll down)
        ...makeRect(280, 20),
      }),
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
        })
      );
    });

    act(() => {
      paginator?.scrollToElement(targetElement, {
        align: 'center',
        behavior: 'instant',
      });
    });

    // First scrollBy fires with a positive delta (wants to scroll down to center)
    expect(scrollElement.scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(1, {
      top: 90,
      behavior: 'instant',
    });
    // RAF correction should NOT fire because scrollTop=max and error>0
  });

  it('preserves the requested focus anchor when retrying pagination after suppression', () => {
    const rangeRef = {
      current: {
        start: 10,
        end: 20,
      },
    };
    const onRangeChange = vi.fn((nextRange: { start: number; end: number }) => {
      rangeRef.current = nextRange;
    });
    const scrollElement = {
      offsetTop: 0,
      offsetHeight: 100,
      scrollHeight: 1000,
      scrollTop: 300,
      getBoundingClientRect: () => makeRect(0, 100),
      querySelector: (selector: string) =>
        rangeRef.current.end === 20 && selector.includes('"F"')
          ? ({
              getBoundingClientRect: () => makeRect(90, 10),
            } as HTMLElement)
          : null,
      scrollBy: vi.fn(),
    } as unknown as HTMLElement;
    const getItemElement = (index: number, range: { start: number; end: number }) => {
      if (index < range.start || index >= range.end) return undefined;

      const offsetTop = (index - range.start) * 20;
      const topBefore = index === 15 ? 200 : 260 + (index - 19) * 20;
      const topAfter = index === 15 ? 120 : 310 + (index - 19) * 20;

      return {
        offsetTop,
        clientHeight: 20,
        getBoundingClientRect: () =>
          makeRect(range.start === 10 ? topBefore : topAfter, 20),
      } as HTMLElement;
    };
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          getItemElement,
          onApi: (api) => {
            paginator = api;
          },
          onRangeChange,
        })
      );
    });

    act(() => {
      paginator?.retryPagination({
        preserveAnchorIndex: 15,
      });
    });

    expect(onRangeChange).toHaveBeenCalledWith({
      start: 14,
      end: 30,
    });
    expect(scrollElement.scrollBy).toHaveBeenCalledWith({
      top: -80,
      behavior: 'instant',
    });
  });
});
