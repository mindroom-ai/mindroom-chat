import {
  ACTIVE_STREAM_STATUSES,
  getStreamStatusFromContent,
  TERMINAL_STREAM_STATUSES,
} from '../matrix/protocol/aiRun';
import { formatDurationParts, formatNow, inSameDay, timeHourMinute } from '../lib/time';

/** When an agent reply started, and when it finished or that it still streams. */
export type ReplyTiming = { startTs: number; endTs?: number; streaming: boolean };

/**
 * The timing of the reply sent at `startTs`, whose shown `content` is that of `edit`, its newest
 * edit: it streams while that content says so (as its reasoning reads it), and it finished when
 * `edit` carries a terminal stream status. Undefined for a message that never streamed and for a
 * reply whose finishing edit is not loaded.
 */
export const getReplyTiming = (
  startTs: number,
  content: Record<string, unknown>,
  edit?: { getTs(): number; getContent(): Record<string, unknown> }
): ReplyTiming | undefined => {
  const status = getStreamStatusFromContent(content);
  if (status && ACTIVE_STREAM_STATUSES.has(status)) return { startTs, streaming: true };
  const editStatus = edit ? getStreamStatusFromContent(edit.getContent()) : undefined;
  if (!edit || !editStatus || !TERMINAL_STREAM_STATUSES.has(editStatus)) return undefined;
  return { startTs, endTs: edit.getTs(), streaming: false };
};

/** What a reply's time adds to its start: the end, and its duration's short form and exact tail. */
export type ReplyTimeParts = { end?: string; short: string; tail: string };

/**
 * The parts of a reply's time after its start: the finish's time of day ("now" while it streams),
 * left out when it reads like the start's, and the duration up to it, as of `now`.
 */
export const getReplyTimeParts = (
  { startTs, endTs, streaming }: ReplyTiming,
  now: number,
  { hour24Clock, language }: { hour24Clock: boolean; language: string }
): ReplyTimeParts => {
  const finish = streaming || endTs === undefined ? undefined : endTs;
  const { short, tail } = formatDurationParts((finish ?? now) - startTs, language);
  if (finish === undefined) return { end: formatNow(language), short, tail };
  const end = timeHourMinute(finish, hour24Clock, language);
  const sameMinute =
    inSameDay(startTs, finish) && end === timeHourMinute(startTs, hour24Clock, language);
  return { end: sameMinute ? undefined : end, short, tail };
};
