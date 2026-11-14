import { describe, expect, it } from 'vitest';
import {
  parseDateTimeLocalValue,
  snoozePresets,
  toDateTimeLocalValue,
  type SnoozePresetId,
} from './snoozePresets';

const presetAt = (now: Date, id: SnoozePresetId) =>
  snoozePresets(now).find((preset) => preset.id === id)?.until;

describe('snoozePresets', () => {
  it('offers the four presets from a Friday afternoon', () => {
    const now = new Date(2026, 10, 13, 15, 30);
    expect(snoozePresets(now).map((preset) => preset.id)).toEqual([
      'inOneHour',
      'inThreeHours',
      'tomorrow',
      'nextMonday',
    ]);
    expect(presetAt(now, 'inOneHour')).toEqual(new Date(2026, 10, 13, 16, 30));
    expect(presetAt(now, 'inThreeHours')).toEqual(new Date(2026, 10, 13, 18, 30));
    expect(presetAt(now, 'tomorrow')).toEqual(new Date(2026, 10, 14, 9, 0));
    expect(presetAt(now, 'nextMonday')).toEqual(new Date(2026, 10, 16, 9, 0));
  });

  it('goes to the Monday after when today is Monday', () => {
    expect(presetAt(new Date(2026, 10, 16, 8, 0), 'nextMonday')).toEqual(
      new Date(2026, 10, 23, 9, 0)
    );
  });

  it('goes to the next day when today is Sunday', () => {
    expect(presetAt(new Date(2026, 10, 15, 22, 0), 'nextMonday')).toEqual(
      new Date(2026, 10, 16, 9, 0)
    );
  });

  it('keeps 09:00 local across a daylight-saving change', () => {
    // vitest.config.ts runs this file in a process of its own, where a new TZ takes effect.
    const zone = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Amsterdam';
      // Summer time ends on 25 October 2026 at 03:00 in Amsterdam.
      expect(new Date(2026, 9, 24, 12).getTimezoneOffset()).toBe(-120);
      expect(new Date(2026, 9, 25, 12).getTimezoneOffset()).toBe(-60);

      const tomorrow = presetAt(new Date(2026, 9, 24, 15, 0), 'tomorrow');
      expect(tomorrow?.getDate()).toBe(25);
      expect(tomorrow?.getHours()).toBe(9);
      expect(tomorrow?.getMinutes()).toBe(0);

      // Friday 23 October: Monday 26 October, on the other side of the change.
      const monday = presetAt(new Date(2026, 9, 23, 15, 0), 'nextMonday');
      expect(monday?.getDate()).toBe(26);
      expect(monday?.getHours()).toBe(9);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe('datetime-local values', () => {
  it('writes and reads local times to the minute', () => {
    expect(toDateTimeLocalValue(new Date(2026, 0, 5, 7, 3, 59))).toBe('2026-01-05T07:03');
    expect(parseDateTimeLocalValue('2026-01-05T07:03')).toEqual(new Date(2026, 0, 5, 7, 3));
    expect(parseDateTimeLocalValue('2026-01-05T07:03:30')).toEqual(new Date(2026, 0, 5, 7, 3, 30));
  });

  it('reads nothing from an empty or malformed value', () => {
    expect(parseDateTimeLocalValue('')).toBeUndefined();
    expect(parseDateTimeLocalValue('2026-01-05')).toBeUndefined();
    expect(parseDateTimeLocalValue('tomorrow')).toBeUndefined();
  });
});
