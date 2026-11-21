import { describe, expect, it } from 'vitest';
import { chooseLandmark, medianResidual } from './CompactRowKeeper';

const order = (ids: string[], inputs: Record<string, string> = {}) => ({
  scope: 'room',
  order: ids,
  inputs: new Map(Object.entries(inputs)),
  viewRef: { current: null },
});

const top = (id: string) => ({ id, after: id });

describe('Compact reading landmark', () => {
  it('uses the first surviving row with known, unchanged inputs', () => {
    const before = order(['a', 'b', 'c', 'd'], { b: '1', c: '2', d: '3' });
    const after = order(['b', 'a', 'd', 'c'], { b: '4', c: '2', d: '3' });
    expect(chooseLandmark(['b', 'c', 'd'], before, after)).toEqual([top('c')]);
  });

  it('anchors the trailing edge of a leading exchange in surviving slots', () => {
    const before = order(['a', 'leaving', 'b', 'c']);
    const after = order(['joining', 'b', 'a', 'c']);
    expect(chooseLandmark(['a', 'leaving', 'b'], before, after)).toEqual([
      { id: 'b', after: 'a', bottom: true },
    ]);
  });

  it('does not count a reversed pair that also moved to different slots', () => {
    const before = order(['a', 'b', 'c'], { a: '1' });
    const after = order(['c', 'b', 'a'], { a: '1' });
    expect(chooseLandmark(['a', 'b'], before, after)).toEqual([top('a')]);
  });

  it('keeps a leading section header ahead of a card exchange', () => {
    const header = 'section:needsYou';
    expect(
      chooseLandmark([header, 'a'], order([header, 'a', 'b']), order([header, 'b', 'a']))
    ).toEqual([top(header)]);
  });

  it('falls back to visible survivors, or nothing if they all left', () => {
    const before = order(['a', 'b', 'c', 'd']);
    const after = order(['c', 'b', 'd', 'new']);
    expect(chooseLandmark(['a', 'b', 'c'], before, after)).toEqual([top('b'), top('c')]);
    expect(chooseLandmark(['a'], before, after)).toEqual([]);
    expect(medianResidual([5, 1, 2])).toBe(2);
    expect(medianResidual([12, 4])).toBe(4);
    expect(medianResidual([-12, -4])).toBe(-4);
    expect(medianResidual([-12, 4])).toBe(0);
    expect(medianResidual([])).toBe(0);
  });
});
