import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  RideTrace,
  deriveClientHeightFromBottomRest,
  extractLedgerSettles,
  parseRideTrace,
  replayLedgerBoundaryGuard,
} from './rideTraceReplay';
import { shouldSettleLedgerAtBoundary } from './threadRenderUtils';

/**
 * Device-trace replay corpus. Each entry is a real recorded ride checked
 * into __tests__/traces/. clientHeight comes from clamp physics (bottom
 * rest plateaus; v3 traces omit the field) — the manifest pins the values
 * and a test asserts the derivation still reproduces them, so a fixture
 * swap cannot silently shift every bounds classification.
 *
 * Corpus provenance:
 * - ipadFill (2026-07-11 13:42, pre-overscroll-fix build): thread open at
 *   the bottom + down-fling while the window filled. Contains the
 *   recorded mid-bounce boundary settle (frame 192: written 87px past the
 *   bottom edge, 87px slip) that motivated the rubber-band deferral.
 * - iphoneFixed (2026-07-11 14:10, deferral deployed): same thread, full
 *   bottom-to-top ride. Its one boundary settle landed with a 1px slip.
 * - iphoneOld* (2026-07-10, pre-fix builds): boundary-settle-heavy rides
 *   with 80-311px anchor slips; kept as detector regression material.
 */
const loadTrace = (name: string): RideTrace =>
  parseRideTrace(
    JSON.parse(readFileSync(new URL(`./__tests__/traces/${name}.json`, import.meta.url), 'utf8'))
  );

const ipadFill = loadTrace('ride-trace-1783802452438');
const iphoneFixed = loadTrace('ride-trace-1783804190290');
const iphoneOldA = loadTrace('ride-trace-1783745470971');
const iphoneOldB = loadTrace('ride-trace-1783737737705');

const CORPUS: { trace: RideTrace; clientHeight: number }[] = [
  { trace: ipadFill, clientHeight: 469 },
  { trace: iphoneFixed, clientHeight: 465 },
  { trace: iphoneOldA, clientHeight: 500 },
  { trace: iphoneOldB, clientHeight: 469 },
];

describe('ride trace corpus', () => {
  it('derives each clientHeight from bottom-rest clamp physics', () => {
    CORPUS.forEach(({ trace, clientHeight }) => {
      expect(deriveClientHeightFromBottomRest(trace.frames, trace.viewport.h)).toBe(clientHeight);
    });
  });

  it('boundary guard never fires outside the physical scroll range on any recorded frame', () => {
    // Property over every frame of every ride, with the ledger forced to
    // settle-worthy magnitudes in both directions so the guard branches
    // are actually exercised (the recorded margin is often 0 while the
    // ledger rides in virtual-core scrollMargin).
    CORPUS.forEach(({ trace, clientHeight }) => {
      [-5000, 5000].forEach((forcedLedgerPx) => {
        const firings = replayLedgerBoundaryGuard(trace.frames, clientHeight, () => forcedLedgerPx);
        const outOfBounds = firings.filter((firing) => firing.outOfBounds);
        expect(outOfBounds).toEqual([]);
      });
    });
  });

  it('defers the recorded mid-bounce settle of ipadFill frame 192 and keeps its landing', () => {
    // The recorded build fired a boundary settle at frame 192 while the
    // scroller sat 87px past the bottom edge mid-bounce (87px visible
    // slip — the write clamped at exactly sh - 469). The trace proves the
    // detector sees it...
    const settles = extractLedgerSettles(ipadFill.frames, 469);
    const outOfBoundsBoundary = settles.filter(
      (settle) => settle.cause === 'boundary' && settle.outOfBoundsBefore
    );
    expect(outOfBoundsBoundary.map((settle) => settle.frameIndex)).toEqual([192]);

    // ...and replaying the pre-settle frames through the CURRENT
    // predicate shows the deferral: no firing on the out-of-bounds
    // bounce-back frames 186-191. The 3439px ledger is recovered from the
    // settle's own scrollTop rewrite — a lower bound, since that write
    // was browser-clamped; any larger value defers the same way.
    const window = ipadFill.frames.slice(185, 192);
    const firings = replayLedgerBoundaryGuard(window, 469, () => 3439);
    expect(firings).toEqual([]);

    // The settle is deferred, not lost: the same geometry at the bounce's
    // in-bounds landing offset still fires.
    const landing = ipadFill.frames[191];
    const innerTop = landing.tr - landing.st;
    expect(
      shouldSettleLedgerAtBoundary({
        ledgerPx: 3439,
        innerTop,
        innerBottom: innerTop + (landing.sh - landing.tr),
        scrollTop: 0,
        scrollBottom: 469,
        scrollOffset: landing.sh - 469,
        clientHeight: 469,
        scrollHeight: landing.sh,
        scrollDirection: 'backward',
      })
    ).toBe(true);
  });

  it('holds the fixed build to its recorded behavior: one clean boundary settle', () => {
    const settles = extractLedgerSettles(iphoneFixed.frames, 465);
    const boundary = settles.filter((settle) => settle.cause === 'boundary');
    expect(boundary).toHaveLength(1);
    expect(boundary[0].outOfBoundsBefore).toBe(false);
    expect(boundary[0].anchorSlipPx).toBeLessThanOrEqual(2);
  });

  it('detects the pre-fix boundary snap class in the 2026-07-10 rides', () => {
    [iphoneOldA, iphoneOldB].forEach((trace, index) => {
      const clientHeight = CORPUS[2 + index].clientHeight;
      const slips = extractLedgerSettles(trace.frames, clientHeight)
        .map((settle) => settle.anchorSlipPx)
        .filter((slip): slip is number => slip !== undefined);
      expect(Math.max(...slips)).toBeGreaterThan(80);
    });
  });

  it('detects the OPEN settle-cascade defect: rest settles that grow content beyond the fold', () => {
    // Not yet fixed (2026-07-11): the quiescence settle's synchronous
    // remount/remeasure changes content height by far more than the
    // ledger fold, in a single 100-240ms frame, right after the ride
    // comes to rest — the remaining "momentum stops, then it jumps"
    // report. Both rides of thread ff7965e2 show it; the anchor row is
    // unmounted in those frames, so anchorSlipPx is blind (undefined).
    // When the cascade fix lands, these goldens should be replaced by
    // thresholds over a post-fix trace.
    const cascade = (trace: RideTrace, clientHeight: number) =>
      extractLedgerSettles(trace.frames, clientHeight).filter(
        (settle) => settle.cause === 'quiescence' && settle.extraGrowthPx > 200
      );

    const ipadCascade = cascade(ipadFill, 469);
    expect(ipadCascade.map((settle) => settle.frameIndex)).toEqual([698, 1713, 1989, 2469]);
    expect(Math.max(...ipadCascade.map((settle) => settle.extraGrowthPx))).toBe(1531);
    ipadCascade.forEach((settle) => {
      expect(settle.frameMs).toBeGreaterThan(100);
      expect(settle.anchorSlipPx).toBeUndefined();
    });

    const iphoneCascade = cascade(iphoneFixed, 465);
    expect(iphoneCascade.map((settle) => settle.frameIndex)).toEqual([641]);
    expect(iphoneCascade[0].extraGrowthPx).toBe(216);
  });
});
