import { describe, expect, it } from 'vitest';
import { isSnoozedAt, nextSnoozeWakeTs, parseThreadSnooze } from './threadSnooze';

const meta = (until: unknown) => ({
  set_by: '@bas:x',
  set_at: '2026-11-13T10:00:00Z',
  data: { until },
});

describe('parseThreadSnooze', () => {
  it('reads until with a zone', () =>
    expect(parseThreadSnooze(meta('2026-11-14T09:00:00+01:00'))?.untilTs).toBe(
      Date.UTC(2026, 10, 14, 8)
    ));

  it('reads until without a zone as UTC', () =>
    expect(parseThreadSnooze(meta('2026-11-14T08:00:00'))?.untilTs).toBe(
      Date.UTC(2026, 10, 14, 8)
    ));

  it.each([
    undefined,
    5,
    'tomorrow',
    '2026-11-14',
    '2027-02-30T08:00:00Z',
    '2026-11-14T24:00:00Z',
    '2026-13-01T08:00:00',
  ])('has no snooze for until %s', (until) =>
    expect(parseThreadSnooze(meta(until))).toBeUndefined()
  );

  it('reads until with a space for the T, as the backend does', () =>
    expect(parseThreadSnooze(meta('2026-11-14 08:00:00+00:00'))?.untilTs).toBe(
      Date.UTC(2026, 10, 14, 8)
    ));

  it('has no snooze without metadata', () => expect(parseThreadSnooze(undefined)).toBeUndefined());

  it('carries who, when and the note', () =>
    expect(parseThreadSnooze({ ...meta('2026-11-14T08:00:00Z'), note: 'after lunch' })).toEqual({
      untilTs: Date.UTC(2026, 10, 14, 8),
      setAtTs: Date.UTC(2026, 10, 13, 10),
      setBy: '@bas:x',
      note: 'after lunch',
    }));
});

describe('isSnoozedAt', () => {
  it('is snoozed only before its time', () => {
    expect(isSnoozedAt(1000, 999)).toBe(true);
    expect(isSnoozedAt(1000, 1000)).toBe(false);
    expect(isSnoozedAt(undefined, 0)).toBe(false);
  });
});

describe('nextSnoozeWakeTs', () => {
  it('finds the next wake among future times', () =>
    expect(nextSnoozeWakeTs([500, undefined, 3000, 2000], 1000)).toBe(2000));

  it('has none when nothing is in the future', () =>
    expect(nextSnoozeWakeTs([500, undefined], 1000)).toBeUndefined());
});
