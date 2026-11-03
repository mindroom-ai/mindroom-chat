export const secondsToMs = (seconds: number): number => seconds * 1000;
export const minutesToMs = (minutes: number): number => secondsToMs(minutes * 60);
export const hoursToMs = (hours: number): number => minutesToMs(hours * 60);
export const daysToMs = (days: number): number => hoursToMs(days * 24);

/** Whether both timestamps fall on the same local calendar day. */
export const inSameDay = (ts1: number, ts2: number): boolean => {
  const a = new Date(ts1);
  const b = new Date(ts2);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

export const today = (ts: number): boolean => inSameDay(ts, Date.now());

export const yesterday = (ts: number): boolean => inSameDay(ts, Date.now() - daysToMs(1));

/** Whole minutes between two timestamps, whichever comes first. */
export const minuteDifference = (ts1: number, ts2: number): number =>
  Math.floor(Math.abs(ts2 - ts1) / minutesToMs(1));

/** A calendar date for a day divider: weekday, day, month and year ("Tuesday, 3 November 2026"). */
export const timeDayMonthYear = (ts: number, language?: string): string =>
  new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(ts);

// Two-digit hours on both clocks ("08:44 PM"), so the times down a timeline line up.
export const timeHourMinute = (ts: number, hour24Clock = false, language?: string): string =>
  new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !hour24Clock,
  }).format(ts);

type RelativeUnit = 'second' | 'minute' | 'hour' | 'day';

const ageOf = (ts: number): number => Math.max(0, Date.now() - ts);

const largestUnit = (ageMs: number): [number, RelativeUnit] => {
  if (ageMs < minutesToMs(1)) return [Math.floor(ageMs / secondsToMs(1)), 'second'];
  if (ageMs < hoursToMs(1)) return [Math.floor(ageMs / minutesToMs(1)), 'minute'];
  if (ageMs < daysToMs(1)) return [Math.floor(ageMs / hoursToMs(1)), 'hour'];
  return [Math.floor(ageMs / daysToMs(1)), 'day'];
};

const formatNow = (language: string): string =>
  new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second');

/**
 * How long ago `ts` was: "now" under five seconds, then the largest whole unit up to days
 * ("5s ago", "3h ago", "2d ago"). `long` spells units out ("2 minutes ago"). Future times read as now.
 */
export const formatRelativeTime = (
  ts: number,
  language = 'en',
  style: 'short' | 'long' = 'short'
): string => {
  const ageMs = ageOf(ts);
  if (ageMs < secondsToMs(5)) return formatNow(language);
  const [value, unit] = largestUnit(ageMs);
  return new Intl.RelativeTimeFormat(language, {
    numeric: 'always',
    style: style === 'long' ? 'long' : 'narrow',
  }).format(-value, unit);
};

/**
 * A short age without "ago" for lists: "now" under a minute, then minutes, hours and days for
 * the first week ("3m", "2h", "6d"), then the date, with the year only for an earlier year.
 */
export const formatCompactRelativeTime = (ts: number, language = 'en'): string => {
  const ageMs = ageOf(ts);
  if (ageMs < minutesToMs(1)) return formatNow(language);
  if (ageMs < daysToMs(7)) {
    const [value, unit] = largestUnit(ageMs);
    return new Intl.NumberFormat(language, {
      style: 'unit',
      unit,
      unitDisplay: 'narrow',
    }).format(value);
  }
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(language, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};
