import type { Virtualizer } from '@tanstack/react-virtual';
import { flushSync } from 'react-dom';

/** Pass attached rows to `measure` at once; scan detached nodes once after React removes them. */
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
type ProgrammaticScroll = { scrollState: unknown };

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
 */
export const createScrollMountMeasurement = <T extends Element>(
  virtualizer: Virtualizer<HTMLDivElement, T>
) => {
  const attached = new Set<T>();
  const programmaticScroll = () => !!(virtualizer as unknown as ProgrammaticScroll).scrollState;
  const measureAttached = () => {
    const nodes = Array.from(attached);
    attached.clear();
    // A programmatic scroll started by the same commit owns measurement now.
    if (programmaticScroll()) return;
    flushSync(() => {
      nodes.forEach((node) => {
        if (!node.isConnected) return;
        virtualizer.resizeItem(
          virtualizer.indexFromElement(node),
          virtualizer.options.measureElement(node, undefined, virtualizer)
        );
      });
    });
  };
  return (node: T | null) => {
    virtualizer.measureElement(node);
    if (!node || !virtualizer.isScrolling || programmaticScroll()) return;
    // A remounted row keeps its cached size, as at rest, without forcing
    // layout; ResizeObserver reports any later change.
    const index = virtualizer.indexFromElement(node);
    if (index < 0 || virtualizer.itemSizeCache.has(virtualizer.options.getItemKey(index))) return;
    if (attached.size === 0) queueMicrotask(measureAttached);
    attached.add(node);
  };
};
