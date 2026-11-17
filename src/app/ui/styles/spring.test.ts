import { describe, expect, it } from 'vitest';
import { springEasing, springOf, springSettled, stepSpring, type SpringState } from './spring';

const run = (ratio: number, ms: number, frames: number, frameSeconds = 1 / 60) => {
  const spring = springOf(ratio, ms);
  let state: SpringState = { value: 0, velocity: 0 };
  const values: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    state = stepSpring(state, 100, frameSeconds, spring);
    values.push(state.value);
  }
  return { state, values };
};

describe('spring', () => {
  it('settles on its target in about its settle time, with a hint of overshoot', () => {
    // 460 ms is about 28 frames at 60 Hz.
    const { state, values } = run(0.78, 460, 30);
    expect(springSettled(state, 100)).toBe(true);
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThan(105);
  });

  it('is still moving partway through', () => {
    const { state } = run(0.78, 460, 6);
    expect(springSettled(state, 100)).toBe(false);
    expect(state.value).toBeGreaterThan(0);
    expect(state.value).toBeLessThan(100);
  });

  it('stays stable across a long frame, such as one after a stalled main thread', () => {
    const { state } = run(0.78, 460, 1, 0.5);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(springSettled(state, 100)).toBe(true);
  });

  it('samples the same curve as a CSS linear() easing that ends on 1', () => {
    const easing = springEasing(0.78, 460);
    const points = easing.slice('linear('.length, -1).split(', ').map(Number);
    expect(points).toHaveLength(49);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(Math.max(...points)).toBeGreaterThan(1);
  });
});
