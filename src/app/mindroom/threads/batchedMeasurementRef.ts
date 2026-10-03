import type { Virtualizer } from '@tanstack/react-virtual';

/** Keep mount measurements synchronous; scan detached nodes once after React removes them. */
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
 * virtual-core measures an attached row only at rest. During a reader's
 * scroll it waits for ResizeObserver, whose update renders after the browser
 * has painted, so a row taller than its estimate is drawn over the next row.
 * Measuring here keeps the correction inside React's commit and its paint.
 */
export const measureVirtualRow = <T extends Element>(
  virtualizer: Virtualizer<HTMLDivElement, T>,
  node: T | null
) => {
  virtualizer.measureElement(node);
  if (!node || !virtualizer.isScrolling) return;
  if ((virtualizer as unknown as ProgrammaticScroll).scrollState) return;
  // Without a ResizeObserver entry, a remounted row reuses its cached size.
  virtualizer.resizeItem(
    virtualizer.indexFromElement(node),
    virtualizer.options.measureElement(node, undefined, virtualizer)
  );
};
