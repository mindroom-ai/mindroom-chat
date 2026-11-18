import type { ChartWidget } from './chartSchema';

const MAX_TICKS = 12;
const STEP_FACTORS = [1, 2, 5, 10];

/**
 * The value range the plot spans: from zero for bars, areas and pies, the values' own range for
 * lines. One value is widened by one each way; undefined when the span is not finite or that
 * widening changes nothing (the values are too large).
 */
export const valueDomain = (
  kind: ChartWidget['kind'],
  series: number[][]
): [number, number] | undefined => {
  const values = series.flat();
  if (values.length === 0) return undefined;
  if (kind !== 'line') values.push(0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(max - min)) return undefined;
  if (min < max) return [min, max];
  if (min === 0) return [0, 1];
  const low = min - 1;
  const high = max + 1;
  return low < min && high > max ? [low, high] : undefined;
};

/**
 * Axis ticks covering `min` to `max`: the step is the smallest of 1, 2, 5 or 10 times a power of
 * ten that is at least the span over `target`, and each tick is computed from its index, so
 * rounding never accumulates. At most 12; just the two ends when no such step exists.
 */
export const niceTicks = (min: number, max: number, target = 4): number[] => {
  const raw = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = STEP_FACTORS.map((factor) => factor * power).find((s) => s >= raw);
  if (step === undefined || !(step > 0) || !Number.isFinite(step)) return [min, max];
  const first = Math.floor(min / step);
  const count = Math.ceil(max / step) - first + 1;
  if (!(count >= 2 && count <= MAX_TICKS)) return [min, max];
  const ticks = Array.from({ length: count }, (_, index) => (first + index) * step);
  // Below a double's spacing the ticks collapse into each other; then just the ends.
  const slack = step * 1e-6;
  const ascending = ticks.every((tick, index) => index === 0 || tick > ticks[index - 1]!);
  const covers = ticks[0]! <= min + slack && ticks[count - 1]! >= max - slack;
  return ascending && covers ? ticks : [min, max];
};

/** Each value's slice of the circle, in radians from 0; undefined when the sum is not finite. */
export const pieSlices = (
  data: number[]
): { start: number; end: number; share: number }[] | undefined => {
  const sum = data.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return undefined;
  let before = 0;
  return data.map((value) => {
    const start = (before / sum) * 2 * Math.PI;
    before += value;
    return { start, end: (before / sum) * 2 * Math.PI, share: value / sum };
  });
};

/** Show every nth x label, so labels at least `minGap` pixels apart fit the plot. */
export const labelStep = (count: number, plotWidth: number, minGap = 48): number =>
  Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / minGap))));
