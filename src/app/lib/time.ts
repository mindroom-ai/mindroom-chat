import { secondsToMinutesAndSeconds } from './common';

export const secondsToMs = (seconds: number): number => seconds * 1000;
export const minutesToMs = (minutes: number): number => secondsToMs(minutes * 60);
export const hoursToMs = (hours: number): number => minutesToMs(hours * 60);
export const daysToMs = (days: number): number => hoursToMs(days * 24);

// Building an Intl formatter resolves its locale and options, which costs far more than formatting
// with it, and lists such as the Compact view format a time for every row on each render. So each
// formatter is built once per language and option set and then reused.
const MAX_CACHED_FORMATTERS = 64;
const formatters = new Map<string, unknown>();

const cachedFormatter = <T>(
  kind: string,
  language: string | undefined,
  options: object,
  create: () => T
): T => {
  const key = `${kind}|${language ?? ''}|${JSON.stringify(options)}`;
  const known = formatters.get(key) as T | undefined;
  if (known) return known;
  const created = create();
  if (formatters.size >= MAX_CACHED_FORMATTERS) formatters.clear();
  formatters.set(key, created);
  return created;
};

// A date formatter keeps the time zone it was built in, so its key carries the current UTC offset:
// after the device moves to another zone, times format in the new one. (Reading the offset is cheap;
// reading the zone's name would mean building a formatter.)
const dateTimeFormat = (language: string | undefined, options: Intl.DateTimeFormatOptions) =>
  cachedFormatter(
    `date${options.timeZone ? '' : new Date().getTimezoneOffset()}`,
    language,
    options,
    () => new Intl.DateTimeFormat(language, options)
  );

const relativeTimeFormat = (language: string, options: Intl.RelativeTimeFormatOptions) =>
  cachedFormatter(
    'relative',
    language,
    options,
    () => new Intl.RelativeTimeFormat(language, options)
  );

const numberFormat = (language: string, options: Intl.NumberFormatOptions) =>
  cachedFormatter('number', language, options, () => new Intl.NumberFormat(language, options));

const unitFormat = (language: string, unit: 'second' | 'minute' | 'hour') =>
  numberFormat(language, { style: 'unit', unit, unitDisplay: 'short' });

/**
 * How long a call lasted: seconds under a minute ("45 sec"), then whole minutes ("3 min"), then
 * hours and minutes ("1 hr 5 min"), in the language's own units and digits.
 */
export const formatCallDuration = (seconds: number, language = 'en'): string => {
  if (seconds < 60) return unitFormat(language, 'second').format(Math.max(0, Math.round(seconds)));
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unitFormat(language, 'minute').format(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [unitFormat(language, 'hour').format(hours)];
  if (rest > 0) parts.push(unitFormat(language, 'minute').format(rest));
  return cachedFormatter(
    'list',
    language,
    { type: 'unit', style: 'narrow' },
    () => new Intl.ListFormat(language, { type: 'unit', style: 'narrow' })
  ).format(parts);
};

/**
 * A moment of a call, from its start, as a clock: `m:ss`, from an hour on `h:mm:ss`; fractions
 * round down.
 */
export const formatCallOffset = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const clock = secondsToMinutesAndSeconds(total % 3600);
  return hours > 0 ? `${hours}:${clock.padStart(5, '0')}` : clock;
};

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
  dateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(ts);

/**
 * Whether `language` tells the time on a 24-hour clock ("14:40" in German, "2:40 PM" in
 * English): the clock the app shows until the user picks one (`useHour24Clock`).
 */
export const languageUses24HourClock = (language?: string): boolean => {
  const { hourCycle } = dateTimeFormat(language, { hour: 'numeric' }).resolvedOptions();
  return hourCycle === 'h23' || hourCycle === 'h24';
};

// Two-digit hours on both clocks ("08:44 PM"), so the times down a timeline line up. Intl writes
// the language's own day period ("오후", "م") and digits.
export const timeHourMinute = (ts: number, hour24Clock = false, language?: string): string =>
  dateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !hour24Clock,
  }).format(ts);

/** The time to the second, for a timestamp's tooltip ("8:44:05 PM", "20:44:05"). */
export const timeHourMinuteSecond = (ts: number, hour24Clock = false, language?: string): string =>
  dateTimeFormat(language, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
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
  relativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second');

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
  return relativeTimeFormat(language, {
    numeric: 'always',
    style: style === 'long' ? 'long' : 'narrow',
  }).format(-value, unit);
};

// Japanese has no narrow units of its own, so they come out in Latin letters ("17m"), and
// Turkish's narrow minute and hour ("17d", "3s") read as days and seconds; both take their
// short units ("17 分", "17 dk.").
const SHORT_AGE_UNITS = new Set(['ja', 'tr']);

/**
 * A short age without "ago" for lists: "now" under a minute, then minutes, hours and days for
 * the first week ("3m", "2h", "6d"), then the date, with the year only for an earlier year.
 */
export const formatCompactRelativeTime = (ts: number, language = 'en'): string => {
  const ageMs = ageOf(ts);
  if (ageMs < minutesToMs(1)) return formatNow(language);
  if (ageMs < daysToMs(7)) {
    const [value, unit] = largestUnit(ageMs);
    return numberFormat(language, {
      style: 'unit',
      unit,
      unitDisplay: SHORT_AGE_UNITS.has(language.split('-')[0] ?? language) ? 'short' : 'narrow',
    }).format(value);
  }
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return dateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
};
