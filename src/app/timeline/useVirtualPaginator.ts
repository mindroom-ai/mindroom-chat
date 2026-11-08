import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useIntersectionObserver } from '../lib/hooks/useIntersectionObserver';

/** A window of item indices: `start` inclusive, `end` exclusive. */
export type ItemRange = {
  start: number;
  end: number;
};

type ScrollAlign = 'start' | 'center' | 'end';

/** Where the element lands in the scroll view. */
type ScrollPlacement = {
  align?: ScrollAlign;
  /** Extra pixels below the aligned position (negative: above). */
  offset?: number;
};

type ScrollToOptions = ScrollPlacement & {
  behavior?: ScrollBehavior;
  /** Leave the scroll position alone when the element is already fully visible. */
  stopInView?: boolean;
};

/** Scrolls to a target in the aligned position; false when nothing scrolled. */
type ScrollAction<Target> = (target: Target, opts?: ScrollToOptions) => boolean;

/** Scrolls `element` into the aligned position. */
export type ScrollToElement = ScrollAction<HTMLElement>;

/** Scrolls to the item at an index, moving the window there first when it is outside it. */
export type ScrollToItem = ScrollAction<number>;

/** `preserveAnchorIndex` keeps that item at its place on screen while the window changes. */
export type RetryPaginationOptions = { preserveAnchorIndex?: number };

/** How the paginator finds the scroll container and the items inside it. */
type PaginatorDom = {
  getScrollElement: () => HTMLElement | null;
  getItemElement: (index: number) => HTMLElement | undefined;
};

/** The window of items in the DOM now and the source of items behind it. */
type PaginatorWindow = {
  range: ItemRange;
  /**
   * Moves the window. A pagination step passes the window it widened (`range` of the render it
   * measured); a jump to an item passes none.
   */
  onRangeChange: (range: ItemRange, pagedFrom?: ItemRange) => void;
  /** How many items the source holds. */
  count: number;
  /** How far one pagination step widens the window. */
  limit: number;
};

type VirtualPaginatorOptions = PaginatorDom &
  PaginatorWindow & {
    /** The window reached the first (`back`) or last item: load more from the source. */
    onEnd?: (back: boolean) => void;
    /** While true, sentinels do not paginate (a focus jump is in progress). */
    shouldSuppressPagination?: () => boolean;
    /**
     * Lets an automatic fill phase own automatic pagination: returns true when it took `retry`
     * and will call it once the layout settles; false to paginate now.
     */
    deferAutomaticPagination?: (retry: () => boolean) => boolean;
    /**
     * How many pixels beyond the visible band a sentinel still counts as in view when the
     * automatic fill phase retries: the opening fill loads history ahead of the reader that far.
     * Pagination the reader's scrolling causes reaches a screen (`readerReach`).
     */
    automaticBackReach?: () => number;
    /**
     * The owner keeps the rows on screen in place when the window grows towards older items
     * (an offset ledger, say), so the paginator leaves the scroll position alone then.
     */
    externalBackwardScrollRestore?: boolean;
  };

type ScrollApi = { scrollToElement: ScrollToElement; scrollToItem: ScrollToItem };

type VirtualPaginator = ScrollApi & {
  /** Indices of the items in the current window, in order. */
  getItems: () => number[];
  /** Paginates again towards a sentinel that is still in view. */
  retryPagination: (opts?: RetryPaginationOptions) => void;
  /** Ref callbacks for the sentinels before the first and after the last item. */
  observeBackAnchor: (element: HTMLElement | null) => void;
  observeFrontAnchor: (element: HTMLElement | null) => void;
};

const PAGINATOR_ANCHOR_ATTRIBUTE = 'data-paginator-anchor';
const BACK_ANCHOR = 'B';
const FRONT_ANCHOR = 'F';

const anchorSelector = (direction: string) => `[${PAGINATOR_ANCHOR_ATTRIBUTE}="${direction}"]`;

export const readScrollPadding = (scrollElement: HTMLElement): { top: number; bottom: number } => {
  if (typeof getComputedStyle !== 'function') return { top: 0, bottom: 0 };
  const style = getComputedStyle(scrollElement);
  const toPixels = (value: string | undefined) => {
    const pixels = Number.parseFloat(value ?? '');
    return Number.isFinite(pixels) ? pixels : 0;
  };
  return { top: toPixels(style.scrollPaddingTop), bottom: toPixels(style.scrollPaddingBottom) };
};

/**
 * How far beyond the visible band the reader's scrolling pages: a screen. Rows load before the
 * reader reaches the end of the loaded ones, and a page that adds less than a screen of rows (most
 * of a page's events can be thread replies and edits the view hides) is followed by the next at
 * once, rather than when the reader has scrolled to the end of the rows again.
 */
const readerReach = (root: HTMLElement): number => root.clientHeight || 0;

/** The sentinel observer's margin: `readerReach` on each side of the scroll area. */
const READER_REACH_MARGIN = '100% 0px';

/**
 * A sentinel is in view where the reader can see it, or within `reach` of that band: the scroll
 * padding is the band that floating bars (a room header, the composer) cover, and a sentinel
 * under them stays hidden.
 */
const isAnchorVisible = (root: HTMLElement, anchor: Element | null, reach = 0): boolean => {
  if (!anchor) return false;
  const view = root.getBoundingClientRect();
  const padding = readScrollPadding(root);
  const rect = anchor.getBoundingClientRect();
  return (
    rect.bottom > view.top + padding.top - reach && rect.top < view.bottom - padding.bottom + reach
  );
};

/** The sentinel is where the observer sees it: the scroll area's box and its margin. */
const isAnchorObserved = (root: HTMLElement, anchor: Element): boolean => {
  const view = root.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  const reach = readerReach(root);
  return rect.bottom > view.top - reach && rect.top < view.bottom + reach;
};

/**
 * The item's top within the scroll content, comparable to `scrollTop`. An item laid out inside
 * another positioned box (a virtual list's absolutely placed tile) counts its `offsetTop` from
 * that box, so it is measured where it is painted instead. An item without an offset parent (not
 * laid out) has only its offsets.
 */
const contentTop = (scrollElement: HTMLElement, element: HTMLElement): number => {
  const { offsetParent } = element;
  if (offsetParent === scrollElement) return element.offsetTop;
  if (!offsetParent) return element.offsetTop - (scrollElement.offsetTop ?? 0);
  const contentOrigin =
    scrollElement.getBoundingClientRect().top + scrollElement.clientTop - scrollElement.scrollTop;
  return element.getBoundingClientRect().top - contentOrigin;
};

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
  const pendingScrollRef = useRef<{ index: number; opts?: ScrollToOptions }>();
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
      const {
        range: currentRange,
        getItemElement,
        onRangeChange,
        externalBackwardScrollRestore,
      } = optionsRef.current;
      if (nextRange.start === currentRange.start && nextRange.end === currentRange.end) return;
      if (externalBackwardScrollRestore && nextRange.start < currentRange.start) {
        anchorRef.current = undefined;
        onRangeChange(nextRange, currentRange);
        return;
      }
      const anchorIndex = preserveAnchorIndex ?? findVisibleIndex(currentRange);
      const anchorElement = anchorIndex === undefined ? undefined : getItemElement(anchorIndex);
      anchorRef.current =
        anchorIndex !== undefined && anchorElement
          ? { index: anchorIndex, top: anchorElement.getBoundingClientRect().top }
          : undefined;
      onRangeChange(nextRange, currentRange);
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

  // Sentinels the observer sees that are farther from the visible band than the reader's reach,
  // under the scroll area's padding. They count once a scroll or a size change brings them
  // within it, which the observer does not report: it sees only its own box.
  const coveredRef = useRef(new Set<string>());

  /**
   * Paginates towards the first sentinel within `reach` of the visible band (default
   * `readerReach`), history first; false when none is.
   */
  const paginateVisibleAnchor = useCallback(
    (opts?: RetryPaginationOptions, reach?: number): boolean => {
      const { getScrollElement, shouldSuppressPagination } = optionsRef.current;
      if (shouldSuppressPagination?.()) return false;
      const root = getScrollElement();
      if (!root) return false;
      const within = reach ?? readerReach(root);
      const back = root.querySelector(anchorSelector(BACK_ANCHOR));
      if (isAnchorVisible(root, back, within)) return paginate(true, opts);
      const front = root.querySelector(anchorSelector(FRONT_ANCHOR));
      if (isAnchorVisible(root, front, within)) return paginate(false, opts);
      // The observer may have reported a sentinel while pagination was held (a focus jump, the
      // opening fill) that has since moved out of reach. It reports nothing more while the
      // sentinel stays where it observes, so it counts as covered from here.
      [
        { direction: BACK_ANCHOR, anchor: back },
        { direction: FRONT_ANCHOR, anchor: front },
      ].forEach(({ direction, anchor }) => {
        if (anchor && isAnchorObserved(root, anchor)) coveredRef.current.add(direction);
      });
      return false;
    },
    [paginate]
  );

  const retryAutomatic = useCallback(
    () => paginateVisibleAnchor(undefined, optionsRef.current.automaticBackReach?.() ?? 0),
    [paginateVisibleAnchor]
  );

  // The automatic fill decides once the opening rows have settled, also when no sentinel ever
  // reaches the scroll area (rows already reach above it, but not as far as it loads ahead).
  const { deferAutomaticPagination } = options;
  useLayoutEffect(() => {
    deferAutomaticPagination?.(retryAutomatic);
  }, [deferAutomaticPagination, retryAutomatic]);

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

  /** Paginates towards the sentinels that came into view, history first. */
  const paginateShown = useCallback(
    (directions: readonly (string | null)[]) => {
      if (optionsRef.current.shouldSuppressPagination?.()) return;
      const back = directions.includes(BACK_ANCHOR);
      if (!back && !directions.includes(FRONT_ANCHOR)) return;
      runAutomatic(() => {
        paginate(back);
      });
    },
    [paginate, runAutomatic]
  );

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const root = optionsRef.current.getScrollElement();
      const covered = coveredRef.current;
      const shown: (string | null)[] = [];
      entries.forEach((entry) => {
        const direction = entry.target.getAttribute(PAGINATOR_ANCHOR_ATTRIBUTE);
        if (direction) covered.delete(direction);
        if (!entry.isIntersecting) return;
        if (direction && root && !isAnchorVisible(root, entry.target, readerReach(root)))
          covered.add(direction);
        else shown.push(direction);
      });
      paginateShown(shown);
    },
    [paginateShown]
  );

  /** Paginates towards the covered sentinels that the reader can see now. */
  const recheckCovered = useCallback(() => {
    const covered = coveredRef.current;
    const root = optionsRef.current.getScrollElement();
    if (covered.size === 0 || !root) return;
    const { back, front } = anchorsRef.current;
    const shown = [
      { direction: BACK_ANCHOR, element: back },
      { direction: FRONT_ANCHOR, element: front },
    ]
      .filter(
        ({ direction, element }) =>
          covered.has(direction) && isAnchorVisible(root, element ?? null, readerReach(root))
      )
      .map(({ direction }) => direction);
    shown.forEach((direction) => covered.delete(direction));
    paginateShown(shown);
  }, [paginateShown]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const recheckOnScroll = (event: Event) => {
      if (event.target === optionsRef.current.getScrollElement()) recheckCovered();
    };
    // Scroll events do not bubble; the capture phase sees the scroll area's whichever it is.
    document.addEventListener('scroll', recheckOnScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', recheckOnScroll, { capture: true });
  }, [recheckCovered]);

  // A size change brings a covered sentinel into view without a scroll too: the scroll area's
  // own, or that of the content holding a sentinel (rows before it measure smaller).
  const resizesRef = useRef<ResizeObserver>();
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const resizes = new ResizeObserver(recheckCovered);
    resizesRef.current = resizes;
    const root = optionsRef.current.getScrollElement();
    if (root) resizes.observe(root);
    const { back, front } = anchorsRef.current;
    [back, front].forEach((anchor) => {
      if (anchor?.parentElement) resizes.observe(anchor.parentElement);
    });
    return () => {
      resizes.disconnect();
      resizesRef.current = undefined;
    };
  }, [recheckCovered]);

  // Read through the ref, so a new `getScrollElement` each render keeps the same observer.
  const getObserverOptions = useCallback(
    () => ({ root: optionsRef.current.getScrollElement(), rootMargin: READER_REACH_MARGIN }),
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
      coveredRef.current.delete(direction);
      if (previous) observer?.unobserve(previous);
      anchorsRef.current[key] = element ?? undefined;
      if (!element) return;
      element.setAttribute(PAGINATOR_ANCHOR_ATTRIBUTE, direction);
      observer?.observe(element);
      if (element.parentElement) resizesRef.current?.observe(element.parentElement);
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
        // Inside the window but not in the DOM: a virtualized owner scrolls its own list there.
        return false;
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

  return useMemo(
    () => ({
      getItems,
      scrollToElement,
      scrollToItem,
      retryPagination,
      observeBackAnchor,
      observeFrontAnchor,
    }),
    [
      getItems,
      scrollToElement,
      scrollToItem,
      retryPagination,
      observeBackAnchor,
      observeFrontAnchor,
    ]
  );
};
