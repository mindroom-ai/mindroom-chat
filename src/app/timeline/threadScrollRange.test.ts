import type { Range, Virtualizer } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { threadScrollRange } from './threadScrollRange';

/** A list of 100 rows of 100 px each in a view 400 px tall. */
const list = () => {
  const measurementsCache = Array.from({ length: 100 }, (_, index) => ({
    index,
    start: index * 100,
    end: (index + 1) * 100,
  }));
  return {
    scrollRect: { width: 800, height: 400 },
    options: {},
    measurementsCache,
    getVirtualItemForOffset: (offset: number) =>
      measurementsCache[Math.min(99, Math.max(0, Math.floor(offset / 100)))],
  } as unknown as Virtualizer<HTMLDivElement, Element>;
};

const range = (startIndex: number, endIndex: number): Range => ({
  startIndex,
  endIndex,
  overscan: 1,
  count: 100,
});

describe('threadScrollRange', () => {
  it('keeps two views of rows mounted on each side of the rows in view', () => {
    const rows = threadScrollRange(range(50, 53), list(), 2);
    expect(rows[0]).toBe(42);
    expect(rows.at(-1)).toBe(62);
    expect(rows).toHaveLength(21);
  });

  it('keeps as many views around as asked: half a view while a thread opens', () => {
    const rows = threadScrollRange(range(50, 53), list(), 0.5);
    // Rows 50 to 53 are in view; the rows 200 px above the first and below the last are kept.
    expect(rows[0]).toBe(48);
    expect(rows.at(-1)).toBe(56);
  });

  it('ends at the last row of a list shown at its end', () => {
    const rows = threadScrollRange(range(96, 99), list(), 0.5);
    expect(rows[0]).toBe(94);
    expect(rows.at(-1)).toBe(99);
  });
});
