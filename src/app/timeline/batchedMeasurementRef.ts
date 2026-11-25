import type { Virtualizer } from '@tanstack/react-virtual';
import { flushSync } from 'react-dom';

/**
 * Pass attached rows to `measure` immediately; scan detached nodes once after
 * React removes them.
 */
export const createBatchedMeasurementRef = <T extends Element>(
  measure: (node: T | null) => void
) => {
  let cleanupQueued = false;
  return (node: T | null) => {
    if (node !== null) {
      measure(node);
      return;
    }
    // virtual-core's null ref scans every cached element. React detaches refs
    // before DOM deletion, so per-row scans are both repeated and premature.
    if (cleanupQueued) return;
    cleanupQueued = true;
    queueMicrotask(() => {
      cleanupQueued = false;
      measure(null);
    });
  };
};

// virtual-core keeps a programmatic scroll's target private and limits
// measurement to rows near that target while it runs.
type ProgrammaticScroll = { scrollState: { toEnd?: boolean } | null };
type SmoothScrollGuard = { shouldMeasureDuringScroll?: (index: number) => boolean };
type ResizeBatch = { notify?: boolean; sync: boolean };
type BatchedResizeVirtualizer = {
  _resizeBatch?: ResizeBatch | null;
  _holdOffset?: number;
  _wheelLive?: boolean;
  observer?: { observe: (el: Element) => void; unobserve: (el: Element) => void };
  notify?: (sync: boolean) => void;
  _noteClampMax?: () => void;
  _flushHoldIfReady?: (sync: boolean) => void;
  _retryClampedAdjustment?: () => void;
};

/**
 * Gives the mounted rows the height they have in the layout of now, the size virtual-core's row
 * observer measures from its entry, so that observer's report of the same pass changes nothing.
 * During a smooth scroll virtual-core owns, only the rows its own observer measures then, those
 * near the scroll's target: the new size of a row far from it must not move the target.
 * `beforeRow` runs before each row takes its size.
 */
export const measureMountedRows = <T extends Element>(
  virtualizer: Pick<Virtualizer<Element, T>, 'elementsCache' | 'indexFromElement' | 'resizeItem'>,
  beforeRow: () => void
): void => {
  const guard = virtualizer as SmoothScrollGuard;
  virtualizer.elementsCache.forEach((row) => {
    const index = virtualizer.indexFromElement(row);
    if (!row.isConnected || guard.shouldMeasureDuringScroll?.(index) === false) return;
    beforeRow();
    virtualizer.resizeItem(index, Math.round(row.getBoundingClientRect().height));
  });
};

/**
 * virtual-core measures an attached row at rest or during a programmatic
 * scroll. During a reader's scroll it waits for ResizeObserver, whose update
 * renders after the browser has painted, so a row taller than its estimate is
 * drawn over the next row.
 *
 * Rows attached during a scroll are measured in a microtask instead: after
 * React has flushed the synchronous updates their own mount queued (a
 * first-pass collapse check, for example), but before the browser paints.
 * The synchronous flush commits the corrected offsets in that same paint.
 *
 * A new row attached at rest is read again in that microtask. virtual-core
 * measures it in the ref, before those updates, and returns that cached size
 * for every later mount, so a row that unmounts before ResizeObserver reports
 * it would keep its first-pass height.
 */
export const createScrollMountMeasurement = <T extends Element>(
  virtualizer: Virtualizer<HTMLDivElement, T>
) => {
  const attached = new Set<T>();
  const programmaticScroll = () => {
    const state = (virtualizer as unknown as ProgrammaticScroll).scrollState;
    return !!state && !state.toEnd;
  };
  // virtual-core's default measurement without its cached-size shortcut.
  const readSize = (node: T) => {
    const element = node as unknown as HTMLElement;
    return virtualizer.options.horizontal ? element.offsetWidth : element.offsetHeight;
  };
  const measureAttached = () => {
    const nodes = Array.from(attached);
    attached.clear();
    // A programmatic scroll started by the same commit owns measurement now.
    if (programmaticScroll()) return;
    // Read every mounted row's size before writing into virtual-core so layout reads
    // never interleave with scroll adjustments or synchronous re-renders.
    const measurements: [number, number][] = [];
    nodes.forEach((node) => {
      if (!node.isConnected) return;
      measurements.push([virtualizer.indexFromElement(node), readSize(node)]);
    });
    if (measurements.length === 0) return;
    const internal = virtualizer as unknown as BatchedResizeVirtualizer;
    if (typeof internal.notify !== 'function' || internal._resizeBatch) {
      flushSync(() => {
        measurements.forEach(([index, size]) => virtualizer.resizeItem(index, size));
      });
      return;
    }
    // Batch the mount pass through virtual-core's _resizeBatch so a multi-row prepend
    // notifies once instead of running one synchronous React render per newly mounted row.
    const batch: ResizeBatch = { sync: false };
    internal._resizeBatch = batch;
    try {
      measurements.forEach(([index, size]) => virtualizer.resizeItem(index, size));
    } finally {
      internal._resizeBatch = null;
      if (batch.notify) {
        if (batch.sync) {
          internal.notify(true);
        } else {
          flushSync(() => internal.notify!(false));
        }
        internal._noteClampMax?.();
        internal._flushHoldIfReady?.(true);
        internal._retryClampedAdjustment?.();
      }
    }
  };
  return (node: T | null) => {
    if (!node || programmaticScroll()) {
      virtualizer.measureElement(node);
      return;
    }
    // A remounted row keeps its cached size without forcing layout;
    // ResizeObserver reports any later change.
    const index = virtualizer.indexFromElement(node);
    const isNew =
      index >= 0 && !virtualizer.itemSizeCache.has(virtualizer.options.getItemKey(index));
    if (!isNew) {
      virtualizer.measureElement(node);
      return;
    }
    // During a live wheel gesture or held prepend, isScrolling can time out to false while
    // scrollTop sits at 0. Register with elementsCache and ResizeObserver without an unbatched
    // synchronous resizeItem per row so measureAttached measures all new rows once in _resizeBatch.
    // At rest (and during scrollToEnd), let virtual-core measure synchronously in the ref so
    // opening pins and layout effects see measured heights before the microtask runs.
    const internal = virtualizer as unknown as BatchedResizeVirtualizer;
    if (
      (internal._holdOffset || internal._wheelLive) &&
      internal.observer &&
      index < virtualizer.options.count
    ) {
      const key = virtualizer.options.getItemKey(index);
      const prevNode = virtualizer.elementsCache.get(key);
      if (prevNode !== node) {
        if (prevNode) internal.observer.unobserve(prevNode);
        internal.observer.observe(node);
        virtualizer.elementsCache.set(key, node);
      }
    } else {
      virtualizer.measureElement(node);
    }
    if (attached.size === 0) queueMicrotask(measureAttached);
    attached.add(node);
  };
};
