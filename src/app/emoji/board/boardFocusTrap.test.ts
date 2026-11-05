import { describe, expect, it, vi } from 'vitest';
import { makeRetryViewTrapOptions, makeTrapOptions } from './boardFocusTrap';

const escape = (init: { defaultPrevented?: boolean } = {}) =>
  ({ defaultPrevented: false, ...init, stopPropagation: vi.fn() } as unknown as KeyboardEvent);

describe('board focus traps', () => {
  it('closes the board whenever its trap deactivates', () => {
    const close = vi.fn();
    makeTrapOptions(close).onDeactivate?.();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the Retry view on Escape and on a click outside, not when the board replaces it', () => {
    const close = vi.fn();
    const options = makeRetryViewTrapOptions(close);
    // Unmounting deactivates the trap, which calls onDeactivate.
    expect(options.onDeactivate).toBeUndefined();

    const deactivatesOnEscape = options.escapeDeactivates as (event: KeyboardEvent) => boolean;
    expect(deactivatesOnEscape(escape({ defaultPrevented: true }))).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(deactivatesOnEscape(escape())).toBe(true);
    expect(close).toHaveBeenCalledOnce();

    const deactivatesOnClick = options.clickOutsideDeactivates as (event: MouseEvent) => boolean;
    expect(deactivatesOnClick({} as MouseEvent)).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
