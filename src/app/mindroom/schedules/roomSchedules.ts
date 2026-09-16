import type { MatrixEvent } from 'matrix-js-sdk';
import {
  parseScheduledTaskStateEvent,
  type ParsedScheduledTask,
} from '../threads/scheduledTaskContract';

export const parseScheduleTimestamp = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  // The scheduler treats offset-free ISO datetimes as UTC.
  const iso = value.replace(' ', 'T');
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso)
    ? `${iso}Z`
    : iso;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

export const getScheduleTimestamp = (task: ParsedScheduledTask): number | undefined =>
  task.scheduleType === 'cron' ? undefined : parseScheduleTimestamp(task.executeAt);

export const getPendingRoomSchedules = (events: readonly MatrixEvent[]): ParsedScheduledTask[] =>
  events
    .map(parseScheduledTaskStateEvent)
    .filter((task): task is ParsedScheduledTask => task !== null && task.status === 'pending')
    .map((task) => (task.threadId === 'main' ? { ...task, threadId: null } : task))
    .sort((left, right) => {
      const leftTime = getScheduleTimestamp(left) ?? Infinity;
      const rightTime = getScheduleTimestamp(right) ?? Infinity;
      return leftTime === rightTime
        ? left.taskId.localeCompare(right.taskId)
        : leftTime - rightTime;
    });
