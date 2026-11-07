import { describe, expect, it } from 'vitest';
import { formatCallDuration, formatCallOffset } from './time';

describe('formatCallDuration', () => {
  it('counts seconds under a minute, then whole minutes, then hours and minutes', () => {
    expect(formatCallDuration(0, 'en')).toBe('0 sec');
    expect(formatCallDuration(45, 'en')).toBe('45 sec');
    expect(formatCallDuration(60, 'en')).toBe('1 min');
    expect(formatCallDuration(89, 'en')).toBe('1 min');
    expect(formatCallDuration(90, 'en')).toBe('2 min');
    expect(formatCallDuration(59 * 60 + 40, 'en')).toBe('1 hr');
    expect(formatCallDuration(3600 + 5 * 60, 'en')).toBe('1 hr 5 min');
    expect(formatCallDuration(2 * 3600, 'en')).toBe('2 hr');
  });

  it("writes the language's own units and digits", () => {
    expect(formatCallDuration(125, 'de')).toBe('2 Min.');
    expect(formatCallDuration(125, 'ar')).toMatch(/[2٢].*د/);
    expect(formatCallDuration(125, 'ja')).toContain('分');
  });
});

describe('formatCallOffset', () => {
  it('writes m:ss under an hour and h:mm:ss from an hour on', () => {
    expect(formatCallOffset(0)).toBe('0:00');
    expect(formatCallOffset(7)).toBe('0:07');
    expect(formatCallOffset(65)).toBe('1:05');
    expect(formatCallOffset(10 * 60)).toBe('10:00');
    expect(formatCallOffset(3599)).toBe('59:59');
    expect(formatCallOffset(3600)).toBe('1:00:00');
    expect(formatCallOffset(3600 + 2 * 60 + 5)).toBe('1:02:05');
    expect(formatCallOffset(11 * 3600 + 59)).toBe('11:00:59');
  });

  it('rounds fractions down, as a clock does', () => {
    expect(formatCallOffset(59.9)).toBe('0:59');
    expect(formatCallOffset(3599.99)).toBe('59:59');
  });
});
