import { describe, expect, it } from 'vitest';
import { isKeyboardFocus } from './dom';

describe('isKeyboardFocus', () => {
  it('counts focus the browser shows as keyboard focus', () => {
    expect(isKeyboardFocus({ matches: () => true } as unknown as Element)).toBe(true);
  });

  it('ignores the focus a click leaves on the row', () => {
    expect(isKeyboardFocus({ matches: () => false } as unknown as Element)).toBe(false);
    expect(isKeyboardFocus(null)).toBe(false);
  });

  it('counts the focus where the engine does not know the selector', () => {
    const element = {
      matches: () => {
        throw new SyntaxError('unknown pseudo-class');
      },
    };
    expect(isKeyboardFocus(element as unknown as Element)).toBe(true);
  });
});
