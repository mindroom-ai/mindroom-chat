import { describe, expect, it } from 'vitest';
import { createHintHold } from './hintHold';

/** A hold with a hand-driven clock: `advance(ms)` runs what is due. */
const setup = (canShow: () => boolean = () => true) => {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const changes: boolean[] = [];
  const hold = createHintHold({
    delayMs: 1000,
    schedule: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    canShow,
    onChange: (shown) => changes.push(shown),
  });
  const advance = (ms: number) => {
    now += ms;
    timers
      .filter((timer) => timer.live && timer.at <= now)
      .forEach((timer) => {
        timer.live = false;
        timer.run();
      });
  };
  return { hold, advance, changes };
};

describe('createHintHold', () => {
  it('shows the hints after the modifier is held alone for a second, and hides them on release', () => {
    const { hold, advance, changes } = setup();
    hold.modifierDown(false);
    advance(999);
    expect(changes).toEqual([]);
    advance(1);
    expect(hold.state).toBe('shown');
    // Auto-repeat of the held key changes nothing.
    hold.modifierDown(true);
    hold.modifierUp();
    expect(changes).toEqual([true, false]);
  });

  it('never shows them for a chord like Mod+C pressed within the second', () => {
    const { hold, advance, changes } = setup();
    hold.modifierDown(false);
    advance(300);
    hold.interrupt();
    advance(1200);
    // The modifier is still down and repeating: it stays cancelled until released.
    hold.modifierDown(true);
    advance(2000);
    expect(changes).toEqual([]);
    expect(hold.state).toBe('cancelled');
    hold.modifierUp();
    expect(hold.state).toBe('idle');
  });

  it('hides them when another key follows once they show', () => {
    const { hold, advance, changes } = setup();
    hold.modifierDown(false);
    advance(1000);
    hold.interrupt();
    expect(changes).toEqual([true, false]);
    hold.modifierDown(true);
    advance(1000);
    expect(changes).toEqual([true, false]);
  });

  it('hides them on a blur, and a new press after it starts over', () => {
    const { hold, advance, changes } = setup();
    hold.modifierDown(false);
    advance(1000);
    hold.interrupt();
    expect(changes).toEqual([true, false]);
    // The key came up outside the window; the next press is a new one.
    hold.modifierDown(false);
    advance(1000);
    expect(changes).toEqual([true, false, true]);
  });

  it('does not start or show while something forbids it', () => {
    let allowed = false;
    const { hold, advance, changes } = setup(() => allowed);
    hold.modifierDown(false);
    advance(1000);
    expect(hold.state).toBe('cancelled');
    hold.modifierUp();
    allowed = true;
    hold.modifierDown(false);
    allowed = false;
    advance(1000);
    expect(changes).toEqual([]);
  });
});
