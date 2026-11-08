import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSCRIPT_SPLIT,
  clampSplit,
  splitFromPointer,
  stepSplit,
  transcriptLayout,
} from './transcriptLayout';

describe('transcriptLayout', () => {
  it.each([
    // The default window, and the tallest window too narrow to sit beside the stage.
    [400, 480, 'stacked'],
    [559, 340, 'stacked'],
    // Wide enough and tall enough: beside the stage.
    [560, 240, 'side'],
    [900, 700, 'side'],
    // Too short for a transcript of its own: the latest line over the stage.
    [340, 220, 'subtitle'],
    [559, 339, 'subtitle'],
    [900, 239, 'subtitle'],
  ] as const)('gives a %i by %i window the %s layout', (width, height, layout) => {
    expect(transcriptLayout({ width, height })).toBe(layout);
  });
});

describe('clampSplit', () => {
  it('keeps the stage between a quarter and four fifths, in whole percent', () => {
    expect(clampSplit(0.1)).toBe(0.25);
    expect(clampSplit(0.95)).toBe(0.8);
    expect(clampSplit(0.6 + 0.05)).toBe(0.65);
    expect(clampSplit(0.4321)).toBe(0.43);
  });

  it('gives the default for a value that is not a number', () => {
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_TRANSCRIPT_SPLIT);
  });
});

describe('splitFromPointer', () => {
  const box = { left: 100, top: 50, right: 500, bottom: 450, width: 400, height: 400 };

  it('measures the stage from the top of a stacked layout', () => {
    expect(splitFromPointer('stacked', box, 300, 250, false)).toBe(0.5);
    expect(splitFromPointer('stacked', box, 300, 60, false)).toBe(0.25);
  });

  it('measures the stage from the start side of a side-by-side layout', () => {
    expect(splitFromPointer('side', box, 380, 0, false)).toBe(0.7);
    // Right to left, the stage starts at the right edge.
    expect(splitFromPointer('side', box, 380, 0, true)).toBe(0.3);
    expect(splitFromPointer('side', box, 999, 0, false)).toBe(0.8);
  });
});

describe('stepSplit', () => {
  it('moves the divider of a stacked layout by 5 percent with Up and Down', () => {
    expect(stepSplit(0.6, 'ArrowDown', 'stacked', false)).toBe(0.65);
    expect(stepSplit(0.6, 'ArrowUp', 'stacked', false)).toBe(0.55);
    expect(stepSplit(0.6, 'ArrowLeft', 'stacked', false)).toBeUndefined();
  });

  it('moves the divider of a side-by-side layout toward the arrow, in either direction', () => {
    expect(stepSplit(0.6, 'ArrowRight', 'side', false)).toBe(0.65);
    expect(stepSplit(0.6, 'ArrowLeft', 'side', false)).toBe(0.55);
    expect(stepSplit(0.6, 'ArrowRight', 'side', true)).toBe(0.55);
    expect(stepSplit(0.6, 'ArrowDown', 'side', false)).toBeUndefined();
  });

  it('goes to the ends with Home and End, and stops there', () => {
    expect(stepSplit(0.6, 'Home', 'side', false)).toBe(0.25);
    expect(stepSplit(0.6, 'End', 'stacked', false)).toBe(0.8);
    expect(stepSplit(0.8, 'ArrowDown', 'stacked', false)).toBe(0.8);
    expect(stepSplit(0.25, 'ArrowUp', 'stacked', false)).toBe(0.25);
    expect(stepSplit(0.6, 'Enter', 'stacked', false)).toBeUndefined();
  });
});
