import { shouldSettleLedgerAtBoundary } from './threadRenderUtils';

/**
 * Ride-trace replay (2026-07-11). The on-device recorder
 * (rideTraceRecorder.ts) captures the per-frame inputs the ledger
 * machinery consumes — scrollTop, scrollHeight, container margin, settle
 * cause counters — in exactly the environment the desktop harness cannot
 * reproduce (iOS compositor momentum, rubber-band physics, coalesced
 * events). Replaying those recorded frame streams through the CURRENT
 * decision logic turns every captured ride into a regression test: the
 * suite can only assert the model we believe in, but a trace is the
 * platform's own testimony.
 *
 * Two layers:
 * - `replayLedgerBoundaryGuard` re-evaluates shouldSettleLedgerAtBoundary
 *   against reconstructed per-frame geometry, so predicate changes are
 *   checked against real rides, not hand-built fixtures (whose geometry
 *   has already been caught lying: a 4000px scroller scrolled to 34400).
 * - `extractLedgerSettles` reads what the RECORDED build actually did —
 *   where settles fired, whether the scroller was out of physical bounds,
 *   how much the anchor slipped, and how much content height changed
 *   beyond the scrollTop shift (the settle-frame remeasure cascade).
 *   Violations in old traces prove the detector works; new traces are
 *   held to the thresholds the fixes promise.
 */

export type RideTraceFrame = {
  /** performance.now() ms at sample time. */
  t: number;
  /** Delta to the previous sample (rAF cadence; spikes = main-thread stalls). */
  dt: number;
  /** scroller.scrollTop (can exceed the physical range during iOS rubber band). */
  st: number;
  /** scroller.scrollHeight. */
  sh: number;
  /** Largest uncovered viewport band, px (virtualizer hole or overscroll background). */
  gap: number;
  /** Document-space movement of the mid-viewport anchor row; 0 when the anchor was re-picked (blind frame). */
  jump: number;
  /** data-thread-count (total thread events, not the mounted window). */
  tc: number;
  /** Inner container marginTop px (offset ledger; ledgerPx = -tr). */
  tr: number;
  touch: 0 | 1;
  /** Cumulative ledger settle cause counters. */
  lq: number;
  lb: number;
};

export type RideTrace = {
  kind: 'mindroom-ride-trace';
  version: number;
  capturedAt: string;
  formFactor: string;
  viewport: { w: number; h: number };
  roomHash: string;
  threadHash: string | null;
  probes: Record<string, number>;
  frames: RideTraceFrame[];
};

export const parseRideTrace = (raw: unknown): RideTrace => {
  const record = raw as RideTrace;
  if (
    !record ||
    record.kind !== 'mindroom-ride-trace' ||
    !Array.isArray(record.frames) ||
    record.frames.length === 0
  ) {
    throw new Error('not a mindroom ride trace');
  }
  if (record.version !== 3) {
    throw new Error(`unsupported ride trace version ${record.version}`);
  }
  return record;
};

/**
 * v3 traces do not record the scroller's clientHeight; recover it from
 * clamp physics. The browser clamps scrollTop to scrollHeight -
 * clientHeight, so every stable rest plateau has sh - st >= clientHeight
 * with equality exactly at the bottom — and rides start there (thread
 * opens land at the bottom). Overscroll never forms a constant run (the
 * bounce animates every frame), so the minimum over >=5-frame constant
 * (st, sh) runs is the true clientHeight. (An earlier gap-based
 * derivation converged on 0.9*viewport + padding — the recorder's gap
 * band is inset 10% — and misclassified ~25px of bottom overscroll;
 * review 2026-07-11 recovered the real values from settle-write clamps.)
 * Returns undefined when the ride never rests at the bottom.
 */
export const deriveClientHeightFromBottomRest = (
  frames: readonly RideTraceFrame[]
): number | undefined => {
  let run = 0;
  let best: number | undefined;
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    const stable =
      frame.st === previous.st && frame.sh === previous.sh && !frame.touch && frame.tc > 0;
    run = stable ? run + 1 : 0;
    if (run >= 5) {
      const candidate = frame.sh - frame.st;
      if (best === undefined || candidate < best) best = candidate;
    }
  }
  return best;
};

// The replay samples at rAF cadence while the guard runs per scroll
// event; classification carries this slack for edge-adjacent frames.
export const CLIENT_HEIGHT_SLACK_PX = 16;

export const isOutOfPhysicalBounds = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): boolean => {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  return (
    scrollTop < -CLIENT_HEIGHT_SLACK_PX || scrollTop > maxScrollTop + CLIENT_HEIGHT_SLACK_PX
  );
};

export type LedgerSettleObservation = {
  frameIndex: number;
  cause: 'boundary' | 'quiescence';
  /** scrollTop rewrite the settle performed (frame delta). */
  scrollShiftPx: number;
  /** scrollHeight change across the settle frame. */
  heightShiftPx: number;
  /**
   * Height change beyond the ledger fold: the settle frame's remeasure /
   * remount cascade. A perfect settle has |extra| ≈ 0; the "stops, then
   * jumps" reports correspond to settles with hundreds of px here.
   */
  extraGrowthPx: number;
  /** Frame duration; the settle cascade shows up as a 100-240ms stall. */
  frameMs: number;
  /**
   * Anchor-measured visual slip. Undefined when the recorder was blind
   * (anchor row unmounted in the settle frame — itself a signal that the
   * settle remounted the window).
   */
  anchorSlipPx: number | undefined;
  /** Whether the pre-settle frame sat outside the physical scroll range. */
  outOfBoundsBefore: boolean;
};

export const extractLedgerSettles = (
  frames: readonly RideTraceFrame[],
  clientHeight: number
): LedgerSettleObservation[] => {
  const settles: LedgerSettleObservation[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    const boundary = frame.lb !== previous.lb;
    const quiescence = frame.lq !== previous.lq;
    if (!boundary && !quiescence) continue;
    const scrollShiftPx = frame.st - previous.st;
    const heightShiftPx = frame.sh - previous.sh;
    // jump === 0 on a large rebase means the anchor was re-picked, not
    // that nothing moved: the recorder computes jump from a tracked
    // anchor and resets silently when the row unmounts.
    const anchorBlind = frame.jump === 0 && Math.abs(scrollShiftPx) > 40;
    settles.push({
      frameIndex: index,
      cause: boundary ? 'boundary' : 'quiescence',
      scrollShiftPx,
      heightShiftPx,
      extraGrowthPx: heightShiftPx - scrollShiftPx,
      frameMs: frame.dt,
      anchorSlipPx: anchorBlind ? undefined : Math.abs(frame.jump - Math.abs(scrollShiftPx)),
      outOfBoundsBefore: isOutOfPhysicalBounds(previous.st, previous.sh, clientHeight),
    });
  }
  return settles;
};

export type BoundaryGuardReplayFiring = {
  frameIndex: number;
  scrollTop: number;
  outOfBounds: boolean;
};

/**
 * Re-evaluate the CURRENT boundary predicate against a recorded frame
 * stream. Geometry is reconstructed from the frame: the scroller rect is
 * pinned at client top 0, the inner container starts at the scroller
 * origin offset by the ledger margin, and its height is the scrollHeight
 * minus that margin. `ledgerPx` defaults to the recorded margin (-tr) but
 * can be overridden per frame — some builds carry the ledger in
 * virtual-core scrollMargin where the recorder cannot see it, and the
 * settle magnitude recovered from the trace is the honest substitute.
 */
export const replayLedgerBoundaryGuard = (
  frames: readonly RideTraceFrame[],
  clientHeight: number,
  getLedgerPx: (frame: RideTraceFrame, index: number) => number = (frame) => -frame.tr
): BoundaryGuardReplayFiring[] => {
  const firings: BoundaryGuardReplayFiring[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    const ledgerPx = getLedgerPx(frame, index);
    const innerTop = frame.tr - frame.st;
    const fired = shouldSettleLedgerAtBoundary({
      ledgerPx,
      innerTop,
      innerBottom: innerTop + (frame.sh - frame.tr),
      scrollTop: 0,
      scrollBottom: clientHeight,
      scrollOffset: frame.st,
      clientHeight,
      scrollHeight: frame.sh,
      scrollDirection:
        frame.st > previous.st ? 'forward' : frame.st < previous.st ? 'backward' : null,
    });
    if (fired) {
      firings.push({
        frameIndex: index,
        scrollTop: frame.st,
        outOfBounds: isOutOfPhysicalBounds(frame.st, frame.sh, clientHeight),
      });
    }
  }
  return firings;
};
