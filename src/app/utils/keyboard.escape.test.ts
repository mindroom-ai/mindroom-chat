import { describe, expect, it, vi } from 'vitest';
import { stopPropagation } from './keyboard';

const escapeIn = (
  target: unknown,
  extra: { defaultPrevented?: boolean; isComposing?: boolean } = {}
) => ({
  target,
  stopPropagation: vi.fn(),
  ...extra,
});

describe('stopPropagation (focus-trap escapeDeactivates)', () => {
  it('closes the trap and keeps Escape from the page behind it', () => {
    const event = escapeIn({ tagName: 'BUTTON' });
    expect(stopPropagation(event)).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it('closes the trap while a text field inside has focus', () => {
    const event = escapeIn({ tagName: 'INPUT' });
    expect(stopPropagation(event)).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it('keeps the trap open when a field already used the key', () => {
    const event = escapeIn({ tagName: 'INPUT' }, { defaultPrevented: true });
    expect(stopPropagation(event)).toBe(false);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('keeps the trap open while an input method composes text', () => {
    const event = escapeIn({ tagName: 'INPUT' }, { isComposing: true });
    expect(stopPropagation(event)).toBe(false);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
