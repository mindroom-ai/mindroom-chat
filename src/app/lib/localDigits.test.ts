import { describe, expect, it } from 'vitest';
import { formatNumber, localDigits } from './localDigits';
import { timeHourMinute } from './time';

describe('localDigits and formatNumber', () => {
  it('write digits as the language does', () => {
    expect(localDigits('5 Nov 2026', 'bn')).toBe('৫ Nov ২০২৬');
    expect(localDigits('99+', 'bn')).toBe('৯৯+');
    expect(localDigits('5 Nov 2026', 'en')).toBe('5 Nov 2026');
    expect(localDigits('5 Nov 2026', 'de')).toBe('5 Nov 2026');
    expect(formatNumber(1234, 'bn')).toBe('১,২৩৪');
    expect(formatNumber(1234, 'en')).toBe('1,234');
  });

  it('leave text alone for a tag Intl does not take', () => {
    expect(localDigits('12', 'not a language')).toBe('12');
  });

  it('match the digits Intl gives the times on the same screen', () => {
    const time = timeHourMinute(new Date(2026, 10, 5, 14, 40).getTime(), false, 'bn');
    expect(time).not.toMatch(/[0-9]/);
    expect(localDigits('02:40', 'bn')).toBe(time.slice(0, 5));
  });
});
