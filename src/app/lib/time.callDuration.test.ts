import { describe, expect, it } from 'vitest';
import { formatCallDuration } from './time';

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
    expect(formatCallDuration(125, 'ar')).toMatch(/٢/);
    expect(formatCallDuration(125, 'ja')).toContain('分');
  });
});
