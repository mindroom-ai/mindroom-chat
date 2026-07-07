import type { MatrixEvent } from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import { saveCachedThreadHeights } from './cacheStore/cacheStoreHeights';

/**
 * Measured-height persistence for thread timelines (schema v4).
 *
 * The offset-ledger machinery only runs when estimates are WRONG: every
 * dropped correction is estimate error, the ledger is its running sum,
 * and a boundary settle repaying it is a momentum interruption (device
 * trace ride-trace-1783444824925: +6327px over one ride through real
 * agent content, three interruptions in 20s). Seeding the virtualizer
 * with the PREVIOUS session's measured heights makes revisited rows
 * exact, so the whole compensation stack becomes a first-visit-only
 * path. This module owns everything except the ~15 wiring lines in the
 * timeline component: layout keying, seed synthesis, and the debounced
 * persister.
 */

// Seed CONSUMPTION is flag-gated OFF until the reopen-reprice acceptance
// test is green: the plumbing is verified end-to-end (saves + loads +
// matching layout keys), but seeded prices are currently CONTRADICTED by
// mount-time remeasurement and make re-rides accrue MORE ledger, not
// less (maxLedger2 4550 seeded vs 650 unseeded — see the red e2e).
// Persisting stays unconditional so real measurement data accumulates in
// the meantime. Enable on a device with
// localStorage['mindroom.debug.seedHeights']='1'.
const HEIGHTS_SEEDING_FLAG_KEY = 'mindroom.debug.seedHeights';
export const isHeightsSeedingEnabled = (): boolean => {
  try {
    return localStorage.getItem(HEIGHTS_SEEDING_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

// Heights are only valid for the layout they were measured under.
// Ingredients: timeline column width (wrap points), layout density and
// zoom (row chrome heights). A mismatch discards the record wholesale.
export const buildThreadLayoutKey = (opts: {
  containerWidth: number;
  messageLayout: number;
  messageSpacing: string;
  pageZoom: number;
}): string =>
  `${Math.round(opts.containerWidth)}|${opts.messageLayout}|${opts.messageSpacing}|${opts.pageZoom}`;

// The virtualizer consumes seeds via options.initialMeasurementsCache,
// applied on the FIRST measurement pass whose list has rows: it writes
// item.key -> item.size into itemSizeCache and recomputes positions from
// there. Only key and size matter, but the array must be VirtualItem-
// shaped and index-ordered — synthesize against the CURRENT event list
// (the persisted snapshot's indexes are stale the moment older pages
// prepend rows).
export const synthesizeInitialMeasurements = (
  threadEvents: readonly Pick<MatrixEvent, 'getId'>[],
  heights: Record<string, number>,
  estimateSize: (index: number) => number
): VirtualItem[] => {
  const items: VirtualItem[] = [];
  let start = 0;
  for (let index = 0; index < threadEvents.length; index += 1) {
    const id = threadEvents[index]?.getId();
    const seeded = id === undefined ? undefined : heights[id];
    const size = seeded ?? estimateSize(index);
    if (seeded !== undefined && id !== undefined) {
      items.push({ index, key: id, size, start, end: start + size, lane: 0 });
    }
    start += size;
  }
  return items;
};

export type ThreadHeightsPersister = {
  // Trailing-debounce arm; call on every commit while the thread is open.
  arm: () => void;
  // Synchronous best-effort flush for unmount/pagehide.
  flush: () => void;
  dispose: () => void;
};

// Snapshot shape: virtual-core's takeSnapshot() VirtualItems, filtered to
// string keys (event ids) — numeric keys are placeholder rows.
export const createThreadHeightsPersister = (opts: {
  sessionId: string;
  roomId: string;
  threadId: string;
  getLayoutKey: () => string;
  takeSnapshot: () => VirtualItem[];
  debounceMs?: number;
}): ThreadHeightsPersister => {
  const debounceMs = opts.debounceMs ?? 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const persistNow = () => {
    timer = undefined;
    if (disposed) return;
    const heights: Record<string, number> = {};
    let count = 0;
    opts.takeSnapshot().forEach((item) => {
      if (typeof item.key === 'string') {
        heights[item.key] = Math.round(item.size);
        count += 1;
      }
    });
    if (count === 0) return;
    void saveCachedThreadHeights(
      opts.sessionId,
      opts.roomId,
      opts.threadId,
      opts.getLayoutKey(),
      heights
    );
  };

  return {
    arm: () => {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(persistNow, debounceMs);
    },
    flush: () => {
      if (timer !== undefined) clearTimeout(timer);
      persistNow();
    },
    dispose: () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
};
