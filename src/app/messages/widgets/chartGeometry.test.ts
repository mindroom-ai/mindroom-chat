import { describe, expect, it } from 'vitest';
import { labelStep, niceTicks, pieSlices, valueDomain } from './chartGeometry';

describe('valueDomain', () => {
  it('starts bars and areas at zero and fits lines to their values', () => {
    expect(valueDomain('bar', [[120, 180.5]])).toEqual([0, 180.5]);
    expect(valueDomain('line', [[120, 180.5]])).toEqual([120, 180.5]);
    expect(valueDomain('area', [[-5, 10]])).toEqual([-5, 10]);
    expect(valueDomain('bar', [[-3], [-8]])).toEqual([-8, 0]);
  });

  it('widens a span of one value', () => {
    expect(valueDomain('line', [[7, 7]])).toEqual([6, 8]);
    expect(valueDomain('line', [[7]])).toEqual([6, 8]);
    expect(valueDomain('bar', [[0, 0]])).toEqual([0, 1]);
  });

  it('gives up on a span that is not finite or cannot be widened', () => {
    expect(valueDomain('line', [[1e308, -1e308]])).toBeUndefined();
    expect(valueDomain('line', [[1e300, 1e300]])).toBeUndefined();
    expect(valueDomain('line', [])).toBeUndefined();
  });
});

describe('niceTicks', () => {
  it('steps by 1, 2 or 5 times a power of ten around the domain', () => {
    expect(niceTicks(0, 180.5)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(-30, 70)).toEqual([-50, 0, 50, 100]);
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(6, 8)).toEqual([6, 6.5, 7, 7.5, 8]);
  });

  it('stays bounded and finite at the extremes', () => {
    expect(niceTicks(0, 5e-324).length).toBeLessThanOrEqual(12);
    expect(niceTicks(0, 5e-324).every(Number.isFinite)).toBe(true);
    expect(niceTicks(0, 1.5e300).every(Number.isFinite)).toBe(true);
    expect(niceTicks(0, 1e-300).length).toBeLessThanOrEqual(12);
  });
});

describe('pieSlices', () => {
  it('splits the circle by share', () => {
    const slices = pieSlices([1, 0, 3]);
    expect(slices?.map((s) => s.share)).toEqual([0.25, 0, 0.75]);
    expect(slices?.[0]?.start).toBe(0);
    expect(slices?.[2]?.end).toBeCloseTo(2 * Math.PI);
  });

  it('gives up when the sum is not finite', () => {
    expect(pieSlices([1e308, 1e308])).toBeUndefined();
  });
});

describe('labelStep', () => {
  it('shows every nth label so labels keep their gap', () => {
    expect(labelStep(6, 600)).toBe(1);
    expect(labelStep(200, 300)).toBe(34);
    expect(labelStep(3, 0)).toBe(3);
  });
});
