import type { TagMetadata } from './threadTags';

export type ThreadSnooze = { untilTs: number; setAtTs: number; setBy: string; note?: string };

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

const parseUntil = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text.includes('T')) return undefined;
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
