import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useIntersectionObserver } from './useIntersectionObserver';

/** A window of item indices: `start` inclusive, `end` exclusive. */
export type ItemRange = {
  start: number;
  end: number;
};

export type ScrollAlign = 'start' | 'center' | 'end';

export type ScrollToOptions = {
  behavior?: ScrollBehavior;
  align?: ScrollAlign;
  /** Extra pixels below the aligned position (negative: above). */
  offset?: number;
  /** Leave the scroll position alone when the element is already fully visible. */
  stopInView?: boolean;
};









export type RetryPaginationOptions = {
  /** Keep this item at its place on screen while the window changes. */
  preserveAnchorIndex?: number;
};









  getItemElement: (index: number) => HTMLElement | undefined;
  /** The window reached the first (`back`) or last item: load more from the source. */
  onEnd?: (back: boolean) => void;
  /** While true, sentinels do not paginate (a focus jump is in progress). */
  shouldSuppressPagination?: () => boolean;
  /**
   * Lets an automatic fill phase own automatic pagination: returns true when it took `retry`
   * and will call it once the layout settles; false to paginate now.
   */
  deferAutomaticPagination?: (retry: () => boolean) => boolean;
};

export type VirtualPaginator = {



  retryPagination: (opts?: RetryPaginationOptions) => void;
  /** Ref callbacks for the sentinels before the first and after the last item. */
  observeBackAnchor: (element: HTMLElement | null) => void;
  observeFrontAnchor: (element: HTMLElement | null) => void;
};

export const PAGINATOR_ANCHOR_ATTRIBUTE = 'data-paginator-anchor';
const BACK_ANCHOR = 'B';
const FRONT_ANCHOR = 'F';

const anchorSelector = (direction: string) => `[${PAGINATOR_ANCHOR_ATTRIBUTE}="${direction}"]`;

const readScrollPadding = (scrollElement: HTMLElement): { top: number; bottom: number } => {
  if (typeof getComputedStyle !== 'function') return { top: 0, bottom: 0 };
  const style = getComputedStyle(scrollElement);
  const toPixels = (value: string | undefined) => {
    const pixels = Number.parseFloat(value ?? '');
    return Number.isFinite(pixels) ? pixels : 0;
  };
  return { top: toPixels(style.scrollPaddingTop), bottom: toPixels(style.scrollPaddingBottom) };
};

const isAnchorVisible = (root: HTMLElement, anchor: Element | null): boolean => {
  if (!anchor) return false;
  const view = root.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  return rect.bottom > view.top && rect.top < view.bottom;
};

/** The item's top within the scroll content, comparable to `scrollTop`. */
const contentTop = (scrollElement: HTMLElement, element: HTMLElement): number =>
  element.offsetParent === scrollElement
    ? element.offsetTop
    : element.offsetTop - (scrollElement.offsetTop ?? 0);

const atScrollBoundary = (scrollElement: HTMLElement, error: number): boolean => {
  const { scrollTop, scrollHeight, clientHeight } = scrollElement;
  if (typeof scrollTop !== 'number') return false;
  if (error < 0) return scrollTop <= 0;
  if (typeof scrollHeight !== 'number' || typeof clientHeight !== 'number') return false;
  return scrollTop >= scrollHeight - clientHeight;
};

/**
 * Pages a window of items for a virtualized timeline. Sentinels before and after the window
 * (`observeBackAnchor`, `observeFrontAnchor`) widen it by `limit` when they come into view,
 * dropping items scrolled far out of view on the other side, and ask the source for more
 * (`onEnd`) at either end. The item on screen keeps its position when the window changes.
 */
export const useVirtualPaginator = (options: VirtualPaginatorOptions): VirtualPaginator => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { range } = options;

  const anchorRef = useRef<{ index: number; top: number }>();
  const pendingScrollRef = useRef<{ index: number; opts?: ScrollToItemOptions }>();
  const previousRangeRef = useRef(range);
  const anchorsRef = useRef<{ back?: HTMLElement; front?: HTMLElement }>({});

  const scrollToElement: ScrollToElement = useCallback((element, opts = {}) => {
    const scrollElement = optionsRef.current.getScrollElement();
    if (!scrollElement) return false;
    const { align = 'center', offset = 0, stopInView = false, behavior } = opts;
    const view = scrollElement.getBoundingClientRect();
    const padding = readScrollPadding(scrollElement);
    const viewTop = view.top + padding.top;
    const viewBottom = view.bottom - padding.bottom;

    const targetTop = (height: number): number => {
      const usableHeight = viewBottom - viewTop;
      // An element taller than the usable view shows its start.
      const effectiveAlign = height > usableHeight ? 'start' : align;
      if (effectiveAlign === 'end') return viewBottom - height + offset;
      if (effectiveAlign === 'center') return viewTop + (usableHeight - height) / 2 + offset;
      return viewTop + offset;
    };

    const rect = element.getBoundingClientRect();
    if (stopInView && rect.top >= viewTop && rect.bottom <= viewBottom) return false;

    const delta = rect.top - targetTop(rect.height);
    scrollElement.scrollBy({ top: delta, behavior });

    if (behavior !== 'smooth' && typeof requestAnimationFrame === 'function') {
      // Layout can still move the element during the scroll; correct once on the next frame.
      requestAnimationFrame(() => {
        const corrected = element.getBoundingClientRect();
        const error = corrected.top - targetTop(corrected.height);
        if (Math.abs(error) < 1 || atScrollBoundary(scrollElement, error)) return;
        scrollElement.scrollBy({ top: error, behavior });
      });
    }
    return true;
  }, []);

  /** The first item at least partly inside the scroll view, by content offsets. */
  const findVisibleIndex = useCallback((itemRange: ItemRange): number | undefined => {
    const { getScrollElement, getItemElement } = optionsRef.current;
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;
    const viewTop = scrollElement.scrollTop;
    const viewBottom = viewTop + scrollElement.offsetHeight;
    for (let index = itemRange.start; index < itemRange.end; index += 1) {
      const element = getItemElement(index);
      if (!element) return undefined;
      const top = contentTop(scrollElement, element);
      if (top + element.clientHeight > viewTop && top < viewBottom) return index;
    }
    return undefined;
  }, []);

  /** Items before the first one still in or below view; `end` when all are above. */
  const firstNotAboveView = useCallback((itemRange: ItemRange): number => {
    const { getScrollElement, getItemElement } = optionsRef.current;
    const scrollElement = getScrollElement();
    if (!scrollElement) return itemRange.start;
    for (let index = itemRange.start; index < itemRange.end; index += 1) {
      const element = getItemElement(index);
      if (!element) return index;
      if (contentTop(scrollElement, element) + element.clientHeight > scrollElement.scrollTop) {
        return index;
      }
    }
    return itemRange.end;
  }, []);

  /** One past the last item still in or above view; `start` when all are below. */
  const lastNotBelowView = useCallback((itemRange: ItemRange): number => {
    const { getScrollElement, getItemElement } = optionsRef.current;
    const scrollElement = getScrollElement();
    if (!scrollElement) return itemRange.end;
    const viewBottom = scrollElement.scrollTop + scrollElement.offsetHeight;
    for (let index = itemRange.end - 1; index >= itemRange.start; index -= 1) {
      const element = getItemElement(index);
      if (!element) return index + 1;
      if (contentTop(scrollElement, element) < viewBottom) return index + 1;
    }
    return itemRange.start;
  }, []);

  const changeRange = useCallback(
    (nextRange: ItemRange, preserveAnchorIndex?: number) => {
      const { range: currentRange, getItemElement, onRangeChange } = optionsRef.current;
      if (nextRange.start === currentRange.start && nextRange.end === currentRange.end) return;
      const anchorIndex = preserveAnchorIndex ?? findVisibleIndex(currentRange);
      const anchorElement = anchorIndex === undefined ? undefined : getItemElement(anchorIndex);
      anchorRef.current =
        anchorIndex !== undefined && anchorElement
          ? { index: anchorIndex, top: anchorElement.getBoundingClientRect().top }
          : undefined;
      onRangeChange(nextRange);
    },
    [findVisibleIndex]
  );

  /** Widens the window towards `back` or asks for more items at that end. */
  const paginate = useCallback(
    (back: boolean, opts?: RetryPaginationOptions): boolean => {
      const { range: currentRange, count, limit, onEnd } = optionsRef.current;
      const preserveAnchorIndex = opts?.preserveAnchorIndex;

      if (back) {
        if (currentRange.start <= 0) {
          onEnd?.(true);
          return true;
        }
        const start = Math.max(0, currentRange.start - limit);
        const keepUntil = Math.max(
          lastNotBelowView(currentRange),
          preserveAnchorIndex === undefined ? 0 : preserveAnchorIndex + 1
        );
        const end = Math.max(start, Math.min(currentRange.end, keepUntil + 1));
        changeRange({ start, end }, preserveAnchorIndex);
        return true;
      }

      if (currentRange.end >= count) {
        onEnd?.(false);
        return true;
      }
      const end = Math.min(count, currentRange.end + limit);
      const keepFrom = Math.min(
        firstNotAboveView(currentRange),
        preserveAnchorIndex ?? Number.POSITIVE_INFINITY
      );
      const start = Math.min(end, Math.max(currentRange.start, keepFrom - 1));
      changeRange({ start, end }, preserveAnchorIndex);
      return true;
    },
    [changeRange, firstNotAboveView, lastNotBelowView]
  );

  /** Paginates towards the first visible sentinel, history first; false when none is visible. */
  const paginateVisibleAnchor = useCallback(
    (opts?: RetryPaginationOptions): boolean => {
      const { getScrollElement, shouldSuppressPagination } = optionsRef.current;
      if (shouldSuppressPagination?.()) return false;
      const root = getScrollElement();
      if (!root) return false;
      if (isAnchorVisible(root, root.querySelector(anchorSelector(BACK_ANCHOR)))) {
        return paginate(true, opts);
      }
      if (isAnchorVisible(root, root.querySelector(anchorSelector(FRONT_ANCHOR)))) {
        return paginate(false, opts);
      }
      return false;
    },
    [paginate]
  );

  const retryAutomatic = useCallback(() => paginateVisibleAnchor(), [paginateVisibleAnchor]);

  /** Runs automatic pagination now, unless the automatic fill phase takes it over. */
  const runAutomatic = useCallback(
    (run: () => void) => {
      const { deferAutomaticPagination } = optionsRef.current;
      if (deferAutomaticPagination?.(retryAutomatic)) return;
      run();
    },
    [retryAutomatic]
  );

  const retryPagination = useCallback(
    (opts?: RetryPaginationOptions) => {
      paginateVisibleAnchor(opts);
    },
    [paginateVisibleAnchor]
  );

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (optionsRef.current.shouldSuppressPagination?.()) return;
      const directions = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => entry.target.getAttribute(PAGINATOR_ANCHOR_ATTRIBUTE));
      const back = directions.includes(BACK_ANCHOR);
      if (!back && !directions.includes(FRONT_ANCHOR)) return;
      runAutomatic(() => {
        paginate(back);
      });
    },
    [paginate, runAutomatic]
  );

  // Read through the ref, so a new `getScrollElement` each render keeps the same observer.
  const getObserverOptions = useCallback(
    () => ({ root: optionsRef.current.getScrollElement() }),
    []
  );
  const observer = useIntersectionObserver(handleIntersection, getObserverOptions);

  useEffect(() => {
    if (!observer) return undefined;
    const { back, front } = anchorsRef.current;
    if (back) observer.observe(back);
    if (front) observer.observe(front);
    return () => {
      if (back) observer.unobserve(back);
      if (front) observer.unobserve(front);
    };
  }, [observer]);

  const observeAnchor = useCallback(
    (key: 'back' | 'front', direction: string, element: HTMLElement | null) => {
      const previous = anchorsRef.current[key];
      if (previous === element) return;
      if (previous) observer?.unobserve(previous);
      anchorsRef.current[key] = element ?? undefined;
      if (!element) return;
      element.setAttribute(PAGINATOR_ANCHOR_ATTRIBUTE, direction);
      observer?.observe(element);
    },
    [observer]
  );
  const observeBackAnchor = useCallback(
    (element: HTMLElement | null) => observeAnchor('back', BACK_ANCHOR, element),
    [observeAnchor]
  );
  const observeFrontAnchor = useCallback(
    (element: HTMLElement | null) => observeAnchor('front', FRONT_ANCHOR, element),
    [observeAnchor]
  );

  const scrollToItem: ScrollToItem = useCallback(
    (index, opts) => {
      const {
        count,
        limit,
        range: currentRange,
        getItemElement,
        onRangeChange,
      } = optionsRef.current;
      if (index < 0 || index >= count) return false;
      if (index >= currentRange.start && index < currentRange.end) {
        const element = getItemElement(index);
        if (element) {
          scrollToElement(element, opts);
          return true;
        }
      }
      pendingScrollRef.current = { index, opts };
      const start = Math.max(0, Math.min(index - Math.floor(limit / 2), count - limit));
      const nextRange = { start, end: Math.min(count, start + limit) };
      if (nextRange.start !== currentRange.start || nextRange.end !== currentRange.end) {
        anchorRef.current = undefined;
        onRangeChange(nextRange);
      }
      return true;
    },
    [scrollToElement]
  );

  // After the window changed: keep the anchor in place, finish a pending jump, and keep
  // paginating while a sentinel stays in view (the observer reports only changes).
  useLayoutEffect(() => {
    const previous = previousRangeRef.current;
    if (previous.start === range.start && previous.end === range.end) return;
    previousRangeRef.current = range;
    const { getScrollElement, getItemElement } = optionsRef.current;

    const anchor = anchorRef.current;
    anchorRef.current = undefined;
    const scrollElement = getScrollElement();
    const anchorElement = anchor ? getItemElement(anchor.index) : undefined;
    if (anchor && anchorElement && scrollElement) {
      const delta = anchorElement.getBoundingClientRect().top - anchor.top;
      if (delta !== 0) scrollElement.scrollBy({ top: delta, behavior: 'instant' });
    }

    const pending = pendingScrollRef.current;
    if (pending) {
      const element = getItemElement(pending.index);
      if (element) {
        pendingScrollRef.current = undefined;
        scrollToElement(element, pending.opts);
      }
      return;
    }

    runAutomatic(() => {
      paginateVisibleAnchor();
    });
  }, [range, runAutomatic, paginateVisibleAnchor, scrollToElement]);

  const { count } = options;
  const getItems = useCallback(() => {
    const items: number[] = [];
    const end = Math.min(range.end, count);
    for (let index = Math.max(0, range.start); index < end; index += 1) items.push(index);
    return items;
  }, [range.start, range.end, count]);






      retryPagination,







      retryPagination,
      observeBackAnchor,
      observeFrontAnchor,
    ]
  );
};
