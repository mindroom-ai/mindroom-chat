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

const SAME_YEAR_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const OTHER_YEAR_DATE: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};
const SAME_DAY_TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const SAME_YEAR_DT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};
const OTHER_YEAR_DT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const TRAILING_TZ_RE = /\s*\((?:UTC|GMT|[A-Za-z_]+\/[A-Za-z0-9_+-]+)[^)]*\)\s*$/i;

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
  locale?: string
): string => {
  const diffMs = executionTime - now;
  if (diffMs <= 0) return t('roomSchedules.awaitingShort');
  if (diffMs < MINUTE_MS)
    return t('roomSchedules.inSeconds', { count: Math.max(1, Math.floor(diffMs / SECOND_MS)) });
  if (diffMs < HOUR_MS)
    return t('roomSchedules.inMinutes', { count: Math.floor(diffMs / MINUTE_MS) });
  if (diffMs < DAY_MS) {
    const totalMinutes = Math.floor(diffMs / MINUTE_MS);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? t('roomSchedules.inHours', { count: hours })
      : t('roomSchedules.inHoursMinutes', { hours, minutes });
  }
  if (diffMs <= WEEK_MS) return t('roomSchedules.inDays', { count: Math.floor(diffMs / DAY_MS) });
  const sameYear = new Date(executionTime).getFullYear() === new Date(now).getFullYear();
  return dateTimeFormat(locale, sameYear ? SAME_YEAR_DATE : OTHER_YEAR_DATE).format(executionTime);
};

/** Compact local timestamp for the row subtitle, omitting redundant date parts and seconds. */
export const formatCompactExecutionTime = (
  executionTime: number,
  now: number,
  locale?: string
): string => {
  const exec = new Date(executionTime);
  const current = new Date(now);
  const sameYear = exec.getFullYear() === current.getFullYear();
  const sameDay =
    sameYear && exec.getMonth() === current.getMonth() && exec.getDate() === current.getDate();
  const opts = sameDay ? SAME_DAY_TIME : sameYear ? SAME_YEAR_DT : OTHER_YEAR_DT;
  return dateTimeFormat(locale, opts).format(executionTime);
};

/** Concise cadence pill label for a recurring task; the full description stays in the subtitle. */
export const formatShortCadence = (task: ParsedScheduledTask, t: TFunction): string => {
  const description = task.cronDescription?.trim();
  const candidate = description?.replace(TRAILING_TZ_RE, '').trim();
  return candidate && candidate.length <= SHORT_CADENCE_MAX_LENGTH
    ? candidate
    : t('roomSchedules.recurring');
};
