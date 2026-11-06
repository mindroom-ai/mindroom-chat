// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markInlineOverflow } from './useInlineScrollFade';

const row = (scrollLeft: number) => {
  const element = document.createElement('div');
  Object.defineProperties(element, {
    scrollLeft: { value: scrollLeft },
    scrollWidth: { value: 500 },
    clientWidth: { value: 300 },
  });
  return element;
};
const marks = (element: HTMLElement) => ({
  start: element.hasAttribute('data-more-start'),
  end: element.hasAttribute('data-more-end'),
});

describe('markInlineOverflow', () => {
  it('marks the edges a sideways row has more beyond, in reading order', () => {
    const cases: Array<[number, { start: boolean; end: boolean }]> = [
      [0, { start: false, end: true }],
      [100, { start: true, end: true }],
      [200, { start: true, end: false }],
      // Right to left: 0 at the start, negative toward the end.
      [-100, { start: true, end: true }],
      [-200, { start: true, end: false }],
    ];
    for (const [scrollLeft, expected] of cases) {
      const element = row(scrollLeft);
      markInlineOverflow(element);
      expect(marks(element), `scrollLeft ${scrollLeft}`).toEqual(expected);
    }
  });

  it('marks nothing on a row that fits', () => {
    const element = document.createElement('div');
    Object.defineProperties(element, {
      scrollWidth: { value: 300 },
      clientWidth: { value: 300 },
    });
    markInlineOverflow(element);
    expect(marks(element)).toEqual({ start: false, end: false });
  });
});
