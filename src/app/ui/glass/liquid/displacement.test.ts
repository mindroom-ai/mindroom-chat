import { describe, expect, it } from 'vitest';
import { createDisplacementMap } from './displacement';

describe('liquid glass displacement', () => {
  // Decode the SVG contract, rather than repeating the map's geometry.
  const shiftAt = (
    map: NonNullable<ReturnType<typeof createDisplacementMap>>,
    x: number,
    y: number
  ): [number, number] => {
    const offset = (y * map.width + x) * 4;
    return [
      map.scale * (map.data[offset]! / 255 - 0.5),
      map.scale * (map.data[offset + 1]! / 255 - 0.5),
    ];
  };

  it('bends all four rims inward while keeping the middle clear', () => {
    const map = createDisplacementMap(200, 100, 20)!;
    const left = shiftAt(map, 3, 50);
    const right = shiftAt(map, 196, 50);
    const top = shiftAt(map, 100, 3);
    const bottom = shiftAt(map, 100, 96);
    expect(left[0]).toBeGreaterThan(3);
    expect(right[0]).toBeLessThan(-3);
    expect(top[1]).toBeGreaterThan(3);
    expect(bottom[1]).toBeLessThan(-3);
    expect(Math.abs(left[1])).toBeLessThan(0.1);
    expect(Math.abs(top[0])).toBeLessThan(0.1);
    expect(left[0] + right[0]).toBeCloseTo(0, 1);
    expect(top[1] + bottom[1]).toBeCloseTo(0, 1);
    expect(shiftAt(map, 100, 50).every((value) => Math.abs(value) < 0.1)).toBe(true);
  });

  it('curves the lens around rounded corners without warping clipped outside pixels', () => {
    const map = createDisplacementMap(200, 100, 20)!;
    const corner = shiftAt(map, 8, 8);
    expect(corner[0]).toBeGreaterThan(2);
    expect(corner[1]).toBeCloseTo(corner[0], 1);
    expect(shiftAt(map, 0, 0).every((value) => Math.abs(value) < 0.1)).toBe(true);
  });

  it('bounds raster work for large surfaces while preserving their aspect ratio', () => {
    const map = createDisplacementMap(4000, 2000, 32)!;
    expect(map.width * map.height).toBeLessThanOrEqual(262144);
    expect(map.width / map.height).toBeCloseTo(2, 1);
    expect(map.data.length).toBe(map.width * map.height * 4);
    expect(map.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true);
  });

  it('clamps oversized radii into a capsule with finite, symmetric displacement', () => {
    const map = createDisplacementMap(44, 44, 9999)!;
    expect(shiftAt(map, 2, 22)[0]).toBeGreaterThan(2);
    expect(shiftAt(map, 41, 22)[0]).toBeLessThan(-2);
    expect(Number.isFinite(map.scale)).toBe(true);
  });

  it('supports asymmetric per-corner radii with CSS proportional clamping', () => {
    const sheet = createDisplacementMap(200, 100, [20, 20, 0, 0])!;
    // Rounded top corners leave clipped outside pixels neutral and bend along the arc.
    expect(shiftAt(sheet, 0, 0).every((value) => Math.abs(value) < 0.1)).toBe(true);
    expect(shiftAt(sheet, 199, 0).every((value) => Math.abs(value) < 0.1)).toBe(true);
    const topLeft = shiftAt(sheet, 8, 8);
    const topRight = shiftAt(sheet, 191, 8);
    expect(topLeft[0]).toBeGreaterThan(2);
    expect(topLeft[1]).toBeCloseTo(topLeft[0], 1);
    expect(topRight[0]).toBeCloseTo(-topLeft[0], 1);
    expect(topRight[1]).toBeCloseTo(topLeft[1], 1);

    // Square bottom corners reach all the way to the corner pixels and stay symmetric.
    const bottomLeft = shiftAt(sheet, 0, 99);
    const bottomRight = shiftAt(sheet, 199, 99);
    expect(bottomLeft[0]).toBeGreaterThan(2);
    expect(bottomLeft[1]).toBeCloseTo(-bottomLeft[0], 1);
    expect(bottomRight[0]).toBeCloseTo(-bottomLeft[0], 1);
    expect(bottomRight[1]).toBeCloseTo(bottomLeft[1], 1);
    expect(shiftAt(sheet, 8, 91)[0]).toBeLessThan(topLeft[0] / 2);

    // Straight edges remain continuous and orthogonal across quadrant boundaries.
    const aboveMid = shiftAt(sheet, 3, 49);
    const belowMid = shiftAt(sheet, 3, 50);
    expect(aboveMid[0]).toBeCloseTo(belowMid[0], 1);
    expect(Math.abs(aboveMid[1])).toBeLessThan(0.1);
    expect(Math.abs(belowMid[1])).toBeLessThan(0.1);

    // Oversized asymmetric radii clamp proportionally without breaking symmetry.
    const clamped = createDisplacementMap(200, 100, [150, 150, 0, 0])!;
    expect(Number.isFinite(clamped.scale)).toBe(true);
    expect(shiftAt(clamped, 0, 0).every((value) => Math.abs(value) < 0.1)).toBe(true);
    expect(shiftAt(clamped, 0, 99)[0]).toBeGreaterThan(2);
  });

  it('smooths corner normals across the 45° diagonal when bezel exceeds corner radius', () => {
    const map = createDisplacementMap(200, 100, 0)!;
    const diagonal = shiftAt(map, 1, 1);
    expect(diagonal[0]).toBeGreaterThan(1);
    expect(diagonal[1]).toBeCloseTo(diagonal[0], 1);

    // Off-diagonal pixels inside the square corner rotate smoothly instead of stepping 90°.
    const nearLeft = shiftAt(map, 1, 2);
    const nearTop = shiftAt(map, 2, 1);
    expect(nearLeft[0]).toBeGreaterThan(nearLeft[1]);
    expect(nearLeft[1]).toBeGreaterThan(0.3);
    expect(nearTop[0]).toBeCloseTo(nearLeft[1], 1);
    expect(nearTop[1]).toBeCloseTo(nearLeft[0], 1);

    // Straight edges far from corners remain strictly orthogonal.
    expect(Math.abs(shiftAt(map, 1, 50)[1])).toBeLessThan(0.1);
    expect(Math.abs(shiftAt(map, 100, 1)[0])).toBeLessThan(0.1);
  });

  it.each([
    [0, 100],
    [100, 0],
    [-1, 100],
    [NaN, 100],
    [100, Infinity],
  ])('skips unavailable dimensions %s × %s', (width, height) => {
    expect(createDisplacementMap(width, height, 12)).toBeNull();
  });
});
