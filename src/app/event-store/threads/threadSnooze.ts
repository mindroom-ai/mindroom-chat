import type { TagMetadata } from './threadTags';

export type ThreadSnooze = { untilTs: number; setAtTs: number; setBy: string; note?: string };

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/i;

/**
 * Whether the date and time are real ones. `Date.parse` rolls February 30 over into March and
 * reads 24:00 as the next day, where the backend refuses both and so never wakes such a snooze.
 */
const isCalendarDateTime = (text: string): boolean => {
  const match = DATE_TIME.exec(text);
  if (!match) return false;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60;
};

const parseUntil = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  // The backend's ISO reader also takes a space for the T.
  const text = value.trim().replace(' ', 'T');
  if (!isCalendarDateTime(text)) return undefined;
  const ts = Date.parse(HAS_ZONE.test(text) ? text : `${text}Z`);
  return Number.isFinite(ts) ? ts : undefined;
};

/** The snooze a `snoozed` tag carries; none when its `until` is missing or invalid. */
export const parseThreadSnooze = (metadata: TagMetadata | undefined): ThreadSnooze | undefined => {
  if (!metadata) return undefined;
  const untilTs = parseUntil(metadata.data?.until);
  if (untilTs === undefined) return undefined;
  const setAt = Date.parse(metadata.set_at);
  return {
    untilTs,
    setAtTs: Number.isFinite(setAt) ? setAt : 0,
    setBy: metadata.set_by,
    ...(metadata.note ? { note: metadata.note } : {}),
  };
};

/** A thread is snoozed only while `until` is later than now. */
export const isSnoozedAt = (snoozedUntilTs: number | undefined, now: number): boolean =>
  snoozedUntilTs !== undefined && snoozedUntilTs > now;

/** The earliest `until` that is still ahead of now. */
export const nextSnoozeWakeTs = (
  untilTsList: Iterable<number | undefined>,
  now: number
): number | undefined => {
  let next: number | undefined;
  for (const ts of untilTsList) {
    if (ts !== undefined && ts > now && (next === undefined || ts < next)) next = ts;
  }
  return next;
};
