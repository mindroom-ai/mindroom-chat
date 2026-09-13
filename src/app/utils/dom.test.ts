import { describe, expect, it } from 'vitest';
import { isInScrollView, isIntersectingScrollView } from './dom';

describe('dom', () => {
  it('checks full containment using viewport-relative rectangles', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 250,
        bottom: 300,
      }),
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(true);
  });

  it('returns false when the child extends above the visible scroll range', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 180,
        bottom: 220,
      }),
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(false);
  });

  it('detects partial intersection using viewport-relative rectangles', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 480,
        bottom: 540,
      }),
    } as HTMLElement;

    expect(isIntersectingScrollView(scrollElement, childElement)).toBe(true);
  });
});
