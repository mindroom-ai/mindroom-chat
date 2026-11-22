import type { TFunction } from 'i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
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

  const execDate = new Date(executionTime);
  const nowDate = new Date(now);
  return new Intl.DateTimeFormat(
    locale,
    execDate.getFullYear() === nowDate.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  ).format(executionTime);
};

/** Compact local timestamp for the row subtitle, omitting redundant date parts and seconds. */
export const formatCompactExecutionTime = (
  executionTime: number,
  now: number,
  locale?: string
): string => {
  const execDate = new Date(executionTime);
  const nowDate = new Date(now);
  const sameYear = execDate.getFullYear() === nowDate.getFullYear();
  const sameDay =
    sameYear &&
    execDate.getMonth() === nowDate.getMonth() &&
    execDate.getDate() === nowDate.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(executionTime);
  }
  if (sameYear) {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(executionTime);
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(executionTime);
};

/** Concise cadence pill label for a recurring task; the full description stays in the subtitle. */
export const formatShortCadence = (task: ParsedScheduledTask, t: TFunction): string => {
  const description = task.cronDescription?.trim();
  if (description) {
    const withoutZone = description.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (withoutZone && withoutZone.length <= SHORT_CADENCE_MAX_LENGTH) {
      return withoutZone;
    }
  }
  return t('roomSchedules.recurring');
};
