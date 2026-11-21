import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from '@tanstack/react-virtual';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const INITIAL_RECT = { width: 0, height: 800 };
const NO_SCROLL_ADJUST = () => false;

type WindowSnapshot = { measurements: VirtualItem[]; margin: number; height: number };
const windows = new WeakMap<ScrollAnchorMemory, Map<string, WindowSnapshot>>();

export function useCompactWindow(
  rows: string[],
  pinned: string[],
  viewRef: RefObject<HTMLDivElement>,
  listRef: RefObject<HTMLDivElement>,
  memory: ScrollAnchorMemory,
  roomId: string,
  retained: readonly (string | undefined)[]
) {
  const saved = useRef(memory.get(roomId));
  const cached = useRef(windows.get(memory)?.get(roomId));
  const [scrollMargin, setScrollMargin] = useState(cached.current?.margin ?? 0);
  const [gestureId, setGestureId] = useState<string>();
  const indexes = useMemo(() => new Map(rows.map((key, index) => [key, index])), [rows]);
  const getItemKey = useCallback((index: number) => rows[index]!, [rows]);
  const estimateSize = (index: number) => (rows[index]?.startsWith('section:') ? 44 : 84);
  const initialOffset = () => {
    const place = saved.current;
    if (!place || place.scrollTop <= 0) return 0;
    const offsets = new Map(place.anchors.map(({ key, offset }) => [key, offset]));
    const sizes = new Map(cached.current?.measurements.map(({ key, size }) => [key, size]));
    let start = scrollMargin;
    let nearest: number | undefined;
    rows.forEach((key, index) => {
      const offset = offsets.get(key);
      const candidate = start - (offset ?? 0);
      if (
        offset !== undefined &&
        (nearest === undefined ||
          Math.abs(candidate - place.scrollTop) < Math.abs(nearest - place.scrollTop))
      ) {
        nearest = candidate;
      }
      start += sizes.get(key) ?? estimateSize(index);
    });
    if (place.anchors.some(({ key }) => pinned.includes(key))) return place.scrollTop;
    return Math.max(0, nearest ?? place.scrollTop);
  };
  const kept = [...retained, gestureId, ...(saved.current?.anchors.map(({ key }) => key) ?? [])];
  const keepKey = kept.join('\n');
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexesInRange = new Set(defaultRangeExtractor(range));
      keepKey.split('\n').forEach((key) => {
        const index = indexes.get(key);
        if (index !== undefined) indexesInRange.add(index);
      });
      return [...indexesInRange].sort((a, b) => a - b);
    },
    [indexes, keepKey]
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewRef.current,
    getItemKey,
    estimateSize,
    rangeExtractor,
    initialOffset,
    initialRect: { ...INITIAL_RECT, height: cached.current?.height ?? INITIAL_RECT.height },
    initialMeasurementsCache: cached.current?.measurements,
    scrollMargin,
    scrollPaddingStart: 160,
    overscan: 8,
  });
  // Let the browser and the Compact order hold anchor normal-flow rows, not virtual-core.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = NO_SCROLL_ADJUST;

  const hasRows = rows.length > 0;
  useLayoutEffect(() => {
    const view = viewRef.current;
    const list = listRef.current;
    if (!view || !list) return undefined;
    const content = list.parentElement;
    const measure = () =>
      setScrollMargin(
        list.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [hasRows, listRef, pinned.length, viewRef]);
  useLayoutEffect(() => {
    // Only the first restore needs these extra rows. Scroll/resize notifications update the range.
    saved.current = undefined;
    cached.current = undefined;
    const view = viewRef.current;
    if (!view) return undefined;
    return () => {
      const rooms = windows.get(memory) ?? new Map<string, WindowSnapshot>();
      rooms.set(roomId, {
        measurements: virtualizer.takeSnapshot(),
        margin: virtualizer.options.scrollMargin,
        height: view.clientHeight || INITIAL_RECT.height,
      });
      windows.set(memory, rooms);
    };
  }, [memory, roomId, viewRef, virtualizer]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const doc = view.ownerDocument;
    let dragging = false;
    const start = (event: Event) => {
      const card = (event.target as Element).closest<HTMLElement>('[data-scroll-anchor]');
      if (card && view.contains(card)) {
        dragging = event.type === 'dragstart';
        setGestureId(card.dataset.scrollAnchor);
      }
    };
    const end = (event: Event) => {
      // Starting a native drag cancels the pointer, not the drag.
      if (dragging && event.type !== 'dragend') return;
      dragging = false;
      setGestureId(undefined);
    };
    const starts = ['pointerdown', 'dragstart'];
    const ends = ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'dragend'];
    starts.forEach((type) => view.addEventListener(type, start, true));
    ends.forEach((type) => doc.addEventListener(type, end));
    return () => {
      starts.forEach((type) => view.removeEventListener(type, start, true));
      ends.forEach((type) => doc.removeEventListener(type, end));
    };
  }, [viewRef]);
  return { virtualizer, indexes };
}
