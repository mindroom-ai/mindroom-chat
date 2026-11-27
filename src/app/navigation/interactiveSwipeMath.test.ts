import { describe, expect, it } from 'vitest';
import {
  createSwipeTracker,
  EDGE_DISCRETE_MIN_PX,
  EDGE_START_MAX_X,
  MAX_VERTICAL_DRIFT,
  PANEL_DISCRETE_MIN_PX,
  SWIPE_COMMIT_RATIO,
  SWIPE_DECELERATION_RATE,
  SWIPE_FLICK_MIN_PX,
  SWIPE_FLICK_VELOCITY,
  SWIPE_LOCK_SLOP_PX,
  SWIPE_PROJECTION_MS,
  SWIPE_REVERSAL_VELOCITY,
  SWIPE_VELOCITY_WINDOW_MS,
} from './interactiveSwipeMath';

describe('interactiveSwipeMath', () => {
  it('exports the expected gesture constants', () => {
    expect(EDGE_START_MAX_X).toBe(28);
    expect(SWIPE_LOCK_SLOP_PX).toBe(10);
    expect(SWIPE_COMMIT_RATIO).toBe(0.35);
    expect(SWIPE_FLICK_MIN_PX).toBe(24);
    expect(SWIPE_FLICK_VELOCITY).toBe(0.45);
    expect(SWIPE_DECELERATION_RATE).toBe(0.998);
    expect(SWIPE_PROJECTION_MS).toBeCloseTo(499);
    expect(SWIPE_REVERSAL_VELOCITY).toBe(-0.3);
    expect(SWIPE_VELOCITY_WINDOW_MS).toBe(100);
    expect(EDGE_DISCRETE_MIN_PX).toBe(72);
    expect(PANEL_DISCRETE_MIN_PX).toBe(56);
    expect(MAX_VERTICAL_DRIFT).toBe(64);
  });

  it('stays pending within slop and locks at 10px with zero jump', () => {
    const tracker = createSwipeTracker({
      startX: 12,
      startY: 200,
      startTimeMs: 100,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

    expect(tracker.state).toBe('pending');
    expect(tracker.move(21, 200, 110, 400)).toBe('pending');
    expect(tracker.offset).toBe(0);
    expect(tracker.progress).toBe(0);
    expect(tracker.shouldCommit(400)).toBe(false);

    expect(tracker.move(22, 200, 120, 400)).toBe('locked');
    expect(tracker.offset).toBe(0);
    expect(tracker.progress).toBe(0);

    expect(tracker.move(122, 205, 160, 400)).toBe('locked');
    expect(tracker.offset).toBe(100);
    expect(tracker.progress).toBeCloseTo(0.25);
  });

  it('handles a single large synthetic jump without losing offset', () => {
    const tracker = createSwipeTracker({
      startX: 10,
      startY: 200,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

    expect(tracker.move(200, 202, 0, 390)).toBe('locked');
    expect(tracker.offset).toBe(180);
    expect(tracker.progress).toBeCloseTo(180 / 390);
    expect(tracker.velocity).toBe(0);
    expect(tracker.shouldCommit(390)).toBe(true);
  });

  it('yields immediately to vertical scroll and remains yielded', () => {
    const tracker = createSwipeTracker({
      startX: 10,
      startY: 200,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

    expect(tracker.move(15, 220, 20, 400)).toBe('yielded');
    expect(tracker.move(250, 220, 80, 400)).toBe('yielded');
    expect(tracker.shouldCommit(400)).toBe(false);
    expect(tracker.shouldCommit(0)).toBe(false);
  });

  it('yields on wrong horizontal direction and remains yielded', () => {
    const tracker = createSwipeTracker({
      startX: 200,
      startY: 200,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: PANEL_DISCRETE_MIN_PX,
    });

    expect(tracker.move(188, 200, 20, 300)).toBe('yielded');
    expect(tracker.move(350, 200, 80, 300)).toBe('yielded');
    expect(tracker.shouldCommit(300)).toBe(false);
  });

  it('supports negative axisSign and clamps offset to [0, extent]', () => {
    const tracker = createSwipeTracker({
      startX: 390,
      startY: 150,
      startTimeMs: 0,
      axisSign: -1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

    expect(tracker.move(380, 150, 10, 300)).toBe('locked');
    expect(tracker.offset).toBe(0);

    // Drag past extent
    tracker.move(0, 150, 100, 300);
    expect(tracker.offset).toBe(300);
    expect(tracker.progress).toBe(1);

    // Drag back past lock origin
    tracker.move(395, 150, 140, 300);
    expect(tracker.offset).toBe(0);
    expect(tracker.progress).toBe(0);
  });

  it('computes rolling 100ms velocity and guards dt <= 0', () => {
    const tracker = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 1000,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

    // dt === 0 yields 0 velocity
    tracker.move(20, 100, 1000, 400);
    expect(tracker.velocity).toBe(0);

    // Slow crawl from t=1000..1200, then fast flick over last 50ms
    tracker.move(30, 100, 1100, 400);
    tracker.move(40, 100, 1200, 400);
    tracker.move(80, 100, 1250, 400);
    // Window cutoff at 1250 is 1150 -> oldest kept sample is (40, 1200), dt=50, dx=40 -> 0.8 px/ms
    expect(tracker.velocity).toBeCloseTo(0.8);
  });

  it('commits at >= 35% extent and cancels below 35% when slow', () => {
    const extent = 400;
    const shortTracker = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    shortTracker.move(10, 100, 20, extent);
    shortTracker.move(149, 100, 1520, extent); // offset 139 < 140 (35%), slow ~0.093 px/ms
    expect(shortTracker.shouldCommit(extent, 1520)).toBe(false);

    const longTracker = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    longTracker.move(10, 100, 20, extent);
    longTracker.move(150, 100, 1520, extent); // offset 140 === 35%
    expect(longTracker.shouldCommit(extent, 1700)).toBe(true); // stationary >= 35% commits
  });

  it('commits on quick flick >= 24px and >= 0.45 px/ms, but not below 24px', () => {
    const extent = 400;
    const tinyFlick = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    tinyFlick.move(10, 100, 10, extent);
    tinyFlick.move(33, 100, 20, extent); // offset 23 (< 24), high velocity
    expect(tinyFlick.velocity).toBeGreaterThanOrEqual(SWIPE_FLICK_VELOCITY);
    expect(tinyFlick.shouldCommit(extent)).toBe(false);

    const goodFlick = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    goodFlick.move(10, 100, 10, extent);
    goodFlick.move(34, 100, 30, extent); // offset 24, velocity = 34/30 > 1.1
    expect(goodFlick.offset).toBe(24);
    expect(goodFlick.shouldCommit(extent)).toBe(true);
  });

  it('decays stale flick velocity to 0 after holding still past the velocity window before lift', () => {
    const extent = 400;
    const tracker = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    // Fast 60px move in 50ms (offset 60 < 35% of 400, velocity > SWIPE_FLICK_VELOCITY).
    tracker.move(10, 100, 10, extent);
    tracker.move(70, 100, 50, extent);
    expect(tracker.offset).toBe(60);
    expect(tracker.velocity).toBeGreaterThanOrEqual(SWIPE_FLICK_VELOCITY);

    // Lifting promptly still commits as a flick.
    expect(tracker.shouldCommit(extent, 60)).toBe(true);
    // Holding still for 250ms before lift (> 100ms velocity window) decays velocity to 0 and cancels.
    expect(tracker.shouldCommit(extent, 300)).toBe(false);

    // Settle duration also ignores stale velocity after holding still.
    const heldFar = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    heldFar.move(10, 100, 10, extent);
    heldFar.move(310, 100, 50, extent); // offset 300, fast velocity 6.2 px/ms
    expect(heldFar.settleDurationMs(false, extent, 50)).toBe(120);
    expect(heldFar.settleDurationMs(false, extent, 300)).toBe(180);
  });

  const createEdgeTracker = () =>
    createSwipeTracker({
      startX: 0,
      startY: 200,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

  it('preserves velocity on stationary touchend lift after a sparse flick', () => {
    const tracker = createEdgeTracker();
    tracker.move(12, 200, 20, 390);
    tracker.move(64, 200, 110, 390);
    tracker.move(64, 200, 126, 390); // stationary lift 16ms later
    expect(tracker.offset).toBe(54);
    expect(tracker.velocity).toBeCloseTo(52 / 90, 3);
    expect(tracker.shouldCommit(390, 126)).toBe(true);
  });

  it('decays velocity to 0 and cancels when y-jitter arrives while holding past 100ms', () => {
    const tracker = createEdgeTracker();
    tracker.move(12, 200, 20, 390);
    tracker.move(70, 200, 60, 390);
    expect(tracker.velocity).toBeGreaterThanOrEqual(SWIPE_FLICK_VELOCITY);
    tracker.move(70, 202, 110, 390);
    tracker.move(70, 199, 170, 390);
    expect(tracker.velocity).toBe(0);
    expect(tracker.shouldCommit(390, 170)).toBe(false);
  });

  it('updates offset and cancels when lift coordinates reverse backward', () => {
    const tracker = createEdgeTracker();
    tracker.move(10, 200, 20, 400);
    tracker.move(180, 200, 300, 400); // offset 170 (42.5% >= 35%)
    expect(tracker.shouldCommit(400, 300)).toBe(true);
    tracker.move(160, 200, 340, 400); // reversal on lift: -20px / 40ms = -0.5 px/ms
    expect(tracker.offset).toBe(150);
    expect(tracker.velocity).toBeCloseTo(-0.5);
    expect(tracker.shouldCommit(400, 340)).toBe(false);
  });

  it('does not dilute initial flick velocity after resting stationary at the edge', () => {
    const tracker = createEdgeTracker();
    tracker.move(0, 201, 250, 390);
    tracker.move(0, 200, 500, 390);
    tracker.move(50, 200, 550, 390); // 50px in 50ms -> 1.0 px/ms, offset 40
    expect(tracker.offset).toBe(40);
    expect(tracker.velocity).toBeCloseTo(1.0);
    expect(tracker.shouldCommit(390, 566)).toBe(true);
  });

  it('commits relaxed swipes via iOS momentum projection and cancels tiny brushes/peeks', () => {
    // Offset 90 (< 35%) at 0.25 px/ms (< 0.45): projects to 90 + 124.75 = 214.75 >= 195 (50%).
    const relaxed = createEdgeTracker();
    relaxed.move(80, 200, 320, 390);
    relaxed.move(100, 200, 400, 390);
    expect(relaxed.offset).toBe(90);
    expect(relaxed.velocity).toBeCloseTo(0.25);
    expect(relaxed.shouldCommit(390, 416)).toBe(true);

    // Tiny brush (< 24px) cancels even though projection would cross 50%.
    const tinyBrush = createEdgeTracker();
    tinyBrush.move(10, 200, 25, 390);
    tinyBrush.move(33, 200, 85, 390); // offset 23, v ~0.388 px/ms
    expect(tinyBrush.offset).toBe(23);
    expect(tinyBrush.shouldCommit(390, 95)).toBe(false);

    // Slow peek (< 35%) whose projection stays under 50% still cancels.
    const slowPeek = createEdgeTracker();
    slowPeek.move(80, 200, 500, 390);
    slowPeek.move(90, 200, 600, 390); // offset 80, v = 0.1 px/ms -> projects to 129.9 < 195
    expect(slowPeek.offset).toBe(80);
    expect(slowPeek.velocity).toBeCloseTo(0.1);
    expect(slowPeek.shouldCommit(390, 616)).toBe(false);
  });

  it('cancels on decisive reversal below 50% extent, but commits at >= 50%', () => {
    const extent = 400;
    const reversedUnderHalf = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    reversedUnderHalf.move(10, 100, 50, extent);
    reversedUnderHalf.move(200, 100, 300, extent);
    reversedUnderHalf.move(180, 100, 340, extent); // offset 170 (42.5% < 50%), v = -20/40 = -0.5 <= -0.3
    expect(reversedUnderHalf.offset).toBe(170);
    expect(reversedUnderHalf.velocity).toBeLessThanOrEqual(SWIPE_REVERSAL_VELOCITY);
    expect(reversedUnderHalf.shouldCommit(extent)).toBe(false);

    const reversedOverHalf = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    reversedOverHalf.move(10, 100, 50, extent);
    reversedOverHalf.move(240, 100, 300, extent);
    reversedOverHalf.move(210, 100, 340, extent); // offset 200 (50%), v = -0.75
    expect(reversedOverHalf.offset).toBe(200);
    expect(reversedOverHalf.shouldCommit(extent)).toBe(true);
  });

  it('clamps settle duration to [120, 260] ms and returns 0 when nothing remains', () => {
    const extent = 390;
    const tracker = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });

    expect(tracker.settleDurationMs(true, 0)).toBe(0);

    tracker.move(10, 100, 10, extent); // offset 0
    expect(tracker.settleDurationMs(false, extent)).toBe(0);
    expect(tracker.settleDurationMs(true, extent)).toBeGreaterThanOrEqual(120);
    expect(tracker.settleDurationMs(true, extent)).toBeLessThanOrEqual(260);

    // Drag to full extent
    tracker.move(400, 100, 500, extent); // offset 390
    expect(tracker.settleDurationMs(true, extent)).toBe(0);
    expect(tracker.settleDurationMs(false, extent)).toBe(240);

    // Fast flick near end clamps to min 120ms
    const fast = createSwipeTracker({
      startX: 0,
      startY: 100,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    fast.move(10, 100, 10, extent);
    fast.move(360, 100, 60, extent); // remaining 40px at 7px/ms -> 5.7ms -> clamps to 120ms
    expect(fast.settleDurationMs(true, extent)).toBe(120);
  });

  it('uses discrete threshold and max vertical drift when extent <= 0', () => {
    const pass = createSwipeTracker({
      startX: 12,
      startY: 300,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    pass.move(84, 340, 10, 0); // rawDx=72, driftY=40 <= 64
    expect(pass.shouldCommit(0)).toBe(true);

    const short = createSwipeTracker({
      startX: 12,
      startY: 300,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    short.move(83, 300, 10, 0); // rawDx=71 < 72
    expect(short.shouldCommit(0)).toBe(false);

    const drifted = createSwipeTracker({
      startX: 12,
      startY: 300,
      startTimeMs: 0,
      axisSign: 1,
      discreteMinPx: EDGE_DISCRETE_MIN_PX,
    });
    drifted.move(50, 300, 10, 0); // locks horizontally first
    drifted.move(120, 365, 20, 0); // driftY=65 > 64
    expect(drifted.shouldCommit(0)).toBe(false);
  });
});
