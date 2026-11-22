import type { TFunction } from 'i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { dateTimeFormat } from '../lib/time';
import {
  isPendingScheduledTaskStatus,
  parseScheduleTimestamp,
  parseScheduledTaskStateEvent,
  type ParsedScheduledTask,
} from '../matrix/protocol/scheduledTaskContract';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const SHORT_CADENCE_MAX_LENGTH = 24;

const SAME_YEAR_DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const OTHER_YEAR_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};
const SAME_DAY_TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const SAME_YEAR_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};
const OTHER_YEAR_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
};

const CALENDAR_PARTS_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

const withTimeZone = (
  options: Intl.DateTimeFormatOptions,
  timeZone?: string
): Intl.DateTimeFormatOptions => (timeZone ? { ...options, timeZone } : options);

const getCalendarParts = (
  timestamp: number,
  timeZone?: string
): { year: string; month: string; day: string } => {
  if (!timeZone) {
    const date = new Date(timestamp);
    return {
      year: String(date.getFullYear()),
      month: String(date.getMonth()),
      day: String(date.getDate()),
    };
  }
  const parts = dateTimeFormat('en-US', { ...CALENDAR_PARTS_OPTIONS, timeZone }).formatToParts(
    timestamp
  );
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }
  return { year, month, day };
};

/** A task that will post to the existing thread, not create another one. */
export const isScheduleInThread = (task: ParsedScheduledTask, threadId: string): boolean =>
  !task.newThread && task.threadId === threadId;

export const getRoomScheduleCount = (
  tasks: readonly ParsedScheduledTask[],
  threadId?: string
): number =>
  threadId === undefined
    ? tasks.length
    : tasks.filter((task) => isScheduleInThread(task, threadId)).length;

/** Whether a task ID can safely be interpolated into a `!cancel_schedule` / `!edit_schedule` command. */
export const isCommandSafeTaskId = (taskId: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(taskId) && taskId.toLowerCase() !== 'all';

export const isRecurringTask = (task: ParsedScheduledTask): boolean =>
  task.scheduleType === 'cron' || !!task.cronExpression || !!task.cronDescription;

export const getScheduleTimestamp = (task: ParsedScheduledTask): number | undefined =>
  task.scheduleType === 'cron' ? undefined : parseScheduleTimestamp(task.executeAt);

export const getPendingRoomSchedules = (events: readonly MatrixEvent[]): ParsedScheduledTask[] =>
  events
    .map(parseScheduledTaskStateEvent)
    .filter(
      (task): task is ParsedScheduledTask =>
        task !== null && isPendingScheduledTaskStatus(task.status)
    )
    .map((task) => (task.threadId === 'main' ? { ...task, threadId: null } : task))
    .sort((left, right) => {
      const leftTime = getScheduleTimestamp(left) ?? Infinity;
      const rightTime = getScheduleTimestamp(right) ?? Infinity;
      return leftTime === rightTime
        ? left.taskId.localeCompare(right.taskId)
        : leftTime - rightTime;
    });

/** Concise countdown pill text for a one-time task relative to `now`. */
export const formatRelativeCountdown = (
  executionTime: number,
  now: number,
  t: TFunction,
  locale?: string,
  timeZone?: string
): string => {
  const diffMs = executionTime - now;
  if (diffMs <= 0) return t('roomSchedules.awaitingShort');
  if (diffMs < MINUTE_MS) {
    const seconds = Math.max(1, Math.floor(diffMs / SECOND_MS));
    return t('roomSchedules.inSeconds', { count: seconds });
  }
  if (diffMs < HOUR_MS) {
    const minutes = Math.floor(diffMs / MINUTE_MS);
    return t('roomSchedules.inMinutes', { count: minutes });
  }
  if (diffMs < DAY_MS) {
    const totalMinutes = Math.floor(diffMs / MINUTE_MS);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? t('roomSchedules.inHours', { count: hours })
      : t('roomSchedules.inHoursMinutes', { hours, minutes });
  }
  if (diffMs <= WEEK_MS) {
    const days = Math.floor(diffMs / DAY_MS);
    return t('roomSchedules.inDays', { count: days });
  }

  const execParts = getCalendarParts(executionTime, timeZone);
  const nowParts = getCalendarParts(now, timeZone);
  return dateTimeFormat(
    locale,
    withTimeZone(
      execParts.year === nowParts.year ? SAME_YEAR_DATE_OPTIONS : OTHER_YEAR_DATE_OPTIONS,
      timeZone
    )
  ).format(executionTime);
};

/** Compact local timestamp for the row subtitle, omitting redundant date parts and seconds. */
export const formatCompactExecutionTime = (
  executionTime: number,
  now: number,
  locale?: string,
  timeZone?: string
): string => {
  const execParts = getCalendarParts(executionTime, timeZone);
  const nowParts = getCalendarParts(now, timeZone);
  const sameYear = execParts.year === nowParts.year;
  const sameDay = sameYear && execParts.month === nowParts.month && execParts.day === nowParts.day;

  if (sameDay) {
    return dateTimeFormat(locale, withTimeZone(SAME_DAY_TIME_OPTIONS, timeZone)).format(
      executionTime
    );
  }
  if (sameYear) {
    return dateTimeFormat(locale, withTimeZone(SAME_YEAR_DATETIME_OPTIONS, timeZone)).format(
      executionTime
    );
  }
  return dateTimeFormat(locale, withTimeZone(OTHER_YEAR_DATETIME_OPTIONS, timeZone)).format(
    executionTime
  );
};

const isRecognizedTimeZone = (value: string): boolean => {
  const candidate = value.trim();
  if (!candidate) return false;
  if (/^(?:UTC|GMT)(?:[+-]\d{1,2}(?::?\d{2})?)?$/i.test(candidate)) return true;
  if (!/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(candidate)) return false;
  try {
    dateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
};

/** Concise cadence pill label for a recurring task; the full description stays in the subtitle. */
export const formatShortCadence = (task: ParsedScheduledTask, t: TFunction): string => {
  const description = task.cronDescription?.trim();
  if (description) {
    const trailingParen = description.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const candidate =
      trailingParen && isRecognizedTimeZone(trailingParen[2] ?? '')
        ? (trailingParen[1] ?? '').trim()
        : description;
    if (candidate && candidate.length <= SHORT_CADENCE_MAX_LENGTH) {
      return candidate;
    }
  }
  return t('roomSchedules.recurring');
};
