import type { MatrixEvent } from 'matrix-js-sdk';
import {
  isPendingScheduledTaskStatus,
  parseScheduleTimestamp,
  parseScheduledTaskStateEvent,
  type ParsedScheduledTask,
} from '../matrix/protocol/scheduledTaskContract';

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
