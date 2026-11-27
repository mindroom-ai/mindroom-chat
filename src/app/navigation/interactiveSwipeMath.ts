export const EDGE_START_MAX_X = 28;
export const SWIPE_LOCK_SLOP_PX = 10;
export const SWIPE_COMMIT_RATIO = 0.35;
export const SWIPE_FLICK_MIN_PX = 24;
export const SWIPE_FLICK_VELOCITY = 0.45;
// Apple UIKit UIScrollView.DecelerationRate.normal (WWDC 2018 Designing Fluid Interfaces).
export const SWIPE_DECELERATION_RATE = 0.998;
export const SWIPE_PROJECTION_MS = SWIPE_DECELERATION_RATE / (1 - SWIPE_DECELERATION_RATE);
export const SWIPE_REVERSAL_VELOCITY = -0.3;
export const SWIPE_VELOCITY_WINDOW_MS = 100;
export const EDGE_DISCRETE_MIN_PX = 72;
export const PANEL_DISCRETE_MIN_PX = 56;
export const MAX_VERTICAL_DRIFT = 64;

const SETTLE_MIN_MS = 120;
const SETTLE_MAX_MS = 260;
const SETTLE_BASE_MS = 240;

export type SwipeTrackerState = 'pending' | 'locked' | 'yielded';

export interface SwipeTracker {
  readonly state: SwipeTrackerState;
  readonly offset: number;
  readonly progress: number;
  readonly velocity: number;
  readonly rawDx: number;
  readonly maxDriftY: number;
  move(x: number, y: number, timeMs: number, extent: number): SwipeTrackerState;
  shouldCommit(extent: number, endTimeMs?: number): boolean;
  settleDurationMs(commit: boolean, extent: number, endTimeMs?: number): number;
}

export interface CreateSwipeTrackerOptions {
  startX: number;
  startY: number;
  startTimeMs: number;
  axisSign: 1 | -1;
  discreteMinPx: number;
}

type VelocitySample = {
  x: number;
  t: number;
};

export function createSwipeTracker({
  startX,
  startY,
  startTimeMs,
  axisSign,
  discreteMinPx,
}: CreateSwipeTrackerOptions): SwipeTracker {
  let state: SwipeTrackerState = 'pending';
  let lockX = startX;
  let offset = 0;
  let progress = 0;
  let velocity = 0;
  let rawDx = 0;
  let maxDriftY = 0;
  const samples: VelocitySample[] = [{ x: startX, t: startTimeMs }];

  const recordSample = (x: number, timeMs: number) => {
    const last = samples[samples.length - 1];
    if (last && last.x === x) {
      if (samples.length === 1 && timeMs > last.t) {
        last.t = timeMs;
      } else if (samples.length > 1 && timeMs - last.t > SWIPE_VELOCITY_WINDOW_MS) {
        velocity = 0;
      }
      return;
    }
    samples.push({ x, t: timeMs });
    const cutoff = timeMs - SWIPE_VELOCITY_WINDOW_MS;
    while (samples.length > 2 && samples[0]!.t < cutoff) {
      samples.shift();
    }
    const oldest = samples[0]!;
    const newest = samples[samples.length - 1]!;
    const dt = newest.t - oldest.t;
    velocity = dt > 0 ? ((newest.x - oldest.x) * axisSign) / dt : 0;
  };

  const resolveVelocity = (endTimeMs?: number): number => {
    if (endTimeMs === undefined) return velocity;
    const newest = samples[samples.length - 1];
    if (!newest || endTimeMs - newest.t > SWIPE_VELOCITY_WINDOW_MS) {
      return 0;
    }
    const cutoff = endTimeMs - SWIPE_VELOCITY_WINDOW_MS;
    let oldestIndex = 0;
    while (oldestIndex < samples.length - 2 && samples[oldestIndex]!.t < cutoff) {
      oldestIndex += 1;
    }
    const oldest = samples[oldestIndex]!;
    const dt = newest.t - oldest.t;
    return dt > 0 ? ((newest.x - oldest.x) * axisSign) / dt : 0;
  };

  const updateOffset = (x: number, extent: number) => {
    const rawOffset = (x - lockX) * axisSign;
    if (extent > 0) {
      offset = Math.max(0, Math.min(extent, rawOffset));
      progress = offset / extent;
    } else {
      offset = Math.max(0, rawOffset);
      progress = 0;
    }
  };

  return {
    get state() {
      return state;
    },
    get offset() {
      return offset;
    },
    get progress() {
      return progress;
    },
    get velocity() {
      return velocity;
    },
    get rawDx() {
      return rawDx;
    },
    get maxDriftY() {
      return maxDriftY;
    },

    move(x: number, y: number, timeMs: number, extent: number): SwipeTrackerState {
      if (state === 'yielded') return state;

      const dx = (x - startX) * axisSign;
      const dy = Math.abs(y - startY);
      rawDx = dx;
      maxDriftY = Math.max(maxDriftY, dy);
      recordSample(x, timeMs);

      if (state === 'pending') {
        if (dy > SWIPE_LOCK_SLOP_PX && dy >= Math.abs(dx)) {
          state = 'yielded';
          return state;
        }
        if (dx < -SWIPE_LOCK_SLOP_PX) {
          state = 'yielded';
          return state;
        }
        if (dx >= SWIPE_LOCK_SLOP_PX && dx > dy) {
          state = 'locked';
          lockX = startX + SWIPE_LOCK_SLOP_PX * axisSign;
        } else {
          return state;
        }
      }

      updateOffset(x, extent);
      return state;
    },

    shouldCommit(extent: number, endTimeMs?: number): boolean {
      if (state !== 'locked') return false;
      if (extent <= 0) {
        return rawDx >= discreteMinPx && maxDriftY <= MAX_VERTICAL_DRIFT;
      }
      const effectiveVelocity = resolveVelocity(endTimeMs);
      if (effectiveVelocity <= SWIPE_REVERSAL_VELOCITY && offset < extent * 0.5) {
        return false;
      }
      return (
        offset >= extent * SWIPE_COMMIT_RATIO ||
        (offset >= SWIPE_FLICK_MIN_PX &&
          (effectiveVelocity >= SWIPE_FLICK_VELOCITY ||
            (effectiveVelocity > 0 &&
              offset + effectiveVelocity * SWIPE_PROJECTION_MS >= extent * 0.5)))
      );
    },

    settleDurationMs(commit: boolean, extent: number, endTimeMs?: number): number {
      if (extent <= 0) return 0;
      const remaining = commit ? Math.max(0, extent - offset) : Math.max(0, offset);
      if (remaining <= 0) return 0;
      const effectiveVelocity = resolveVelocity(endTimeMs);
      const speed = Math.max(Math.abs(effectiveVelocity), extent / SETTLE_BASE_MS);
      return Math.round(Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, remaining / speed)));
    },
  };
}
