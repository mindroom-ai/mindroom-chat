import { describe, expect, it } from 'vitest';
import { languageUses24HourClock, timeHourMinute, timeHourMinuteSecond } from './time';

const AFTERNOON = new Date(2026, 10, 5, 14, 40, 5).getTime();

describe('the clock of each language', () => {
  it('runs to 24 hours in German, French and Russian, to 12 in English', () => {
    expect(['de', 'fr', 'ru'].map((language) => languageUses24HourClock(language))).toEqual([
      true,
      true,
      true,
    ]);
    expect(languageUses24HourClock('en')).toBe(false);
  });

  it('gives German times no day period on its own clock', () => {
    expect(timeHourMinute(AFTERNOON, languageUses24HourClock('de'), 'de')).toBe('14:40');
    expect(timeHourMinute(AFTERNOON, languageUses24HourClock('en'), 'en')).toBe('02:40 PM');
    expect(timeHourMinuteSecond(AFTERNOON, true, 'de')).toBe('14:40:05');
    expect(timeHourMinuteSecond(AFTERNOON, false, 'en')).toBe('2:40:05 PM');
  });
});
