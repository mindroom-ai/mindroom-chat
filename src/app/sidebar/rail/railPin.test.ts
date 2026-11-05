import { describe, expect, it } from 'vitest';
import { PIN_FROM, UNPIN_BELOW, buttonsThatFit, nextPinned, revealDistance } from './railPin';

// Rail buttons are 42 px, 12 px apart, in a stack padded 12 px at its start.
const fit = (length: number) => buttonsThatFit(length, 42, 12, 12);

describe('buttonsThatFit', () => {
  it('counts only whole buttons after the padding', () => {
    expect(fit(0)).toBe(0);
    expect(fit(53)).toBe(0);
    expect(fit(54)).toBe(1);
    expect(fit(12 + 4 * 42 + 3 * 12)).toBe(4);
    expect(fit(12 + 4 * 42 + 3 * 12 - 1)).toBe(3);
    expect(fit(12 + 5 * 42 + 4 * 12)).toBe(5);
    expect(fit(-200)).toBe(0);
  });

  it('fits nothing before the buttons have a size', () => {
    expect(buttonsThatFit(500, 0, 0, 0)).toBe(0);
    expect(buttonsThatFit(500, Number.NaN, 12, 12)).toBe(0);
  });
});

describe('nextPinned', () => {
  it('lets go of the top group below four buttons and pins it again from five', () => {
    expect(UNPIN_BELOW).toBe(4);
    expect(PIN_FROM).toBe(5);
    expect(nextPinned(true, 4)).toBe(true);
    expect(nextPinned(true, 3)).toBe(false);
    expect(nextPinned(false, 4)).toBe(false);
    expect(nextPinned(false, 5)).toBe(true);
  });

  it('never flips back and forth while a window is resized across the limit', () => {
    // A window growing a pixel at a time from 2 to 6 buttons' room, and shrinking back.
    const lengths = Array.from({ length: 300 }, (_, step) => 120 + step);
    const run = (from: boolean, sequence: number[]) => {
      let pinned = from;
      const switches: number[] = [];
      sequence.forEach((length) => {
        const next = nextPinned(pinned, fit(length));
        if (next !== pinned) switches.push(length);
        pinned = next;
      });
      return { pinned, switches };
    };
    const growing = run(false, lengths);
    expect(growing.switches).toEqual([12 + 5 * 42 + 4 * 12]);
    expect(growing.pinned).toBe(true);
    const shrinking = run(true, [...lengths].reverse());
    expect(shrinking.switches).toEqual([12 + 4 * 42 + 3 * 12 - 1]);
    expect(shrinking.pinned).toBe(false);
    // Between the two limits the layout stays whichever it was.
    const between = [216, 240, 269, 230, 216];
    expect(run(true, between).switches).toEqual([]);
    expect(run(false, between).switches).toEqual([]);
  });
});

describe('revealDistance', () => {
  const view = { top: 100, bottom: 400 };

  it('leaves an entry that shows whole clear of the edges', () => {
    expect(revealDistance(view, { top: 116, bottom: 158 }, 16)).toBe(0);
    expect(revealDistance(view, { top: 342, bottom: 384 }, 16)).toBe(0);
  });

  it('scrolls up or down the least distance', () => {
    expect(revealDistance(view, { top: 90, bottom: 132 }, 16)).toBe(-26);
    expect(revealDistance(view, { top: 380, bottom: 422 }, 16)).toBe(38);
    expect(revealDistance(view, { top: -500, bottom: -458 }, 0)).toBe(-600);
  });

  it('lines up an entry taller than the view with its top', () => {
    expect(revealDistance(view, { top: 150, bottom: 700 }, 16)).toBe(34);
  });
});
