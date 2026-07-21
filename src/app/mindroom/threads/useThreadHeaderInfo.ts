import type { Room } from 'matrix-js-sdk/lib/models/room';
import { formatScheduledTime } from './compactThreadCardUtils';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadScheduledStatus } from './useThreadScheduledStatus';

export type ThreadHeaderInfo = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
};

export type ThreadScheduledDisplay = {
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
};

export const getThreadScheduledDisplay = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined
): ThreadScheduledDisplay => {
  if (nextScheduledTs !== undefined) {
    const scheduledTime = formatScheduledTime(nextScheduledTs);
    if (scheduledTime) {
      return {
        nextScheduledTs,
        scheduledDisplayText: scheduledTime,
      };
    }
  }
  if (scheduledTaskCount <= 0) {
    return {
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    };
  }
  return {
    nextScheduledTs: undefined,
    scheduledDisplayText: `${scheduledTaskCount} scheduled ${
      scheduledTaskCount === 1 ? 'task' : 'tasks'
    }`,
  };
};

export const useThreadHeaderInfo = (room: Room, threadId: string | undefined): ThreadHeaderInfo => {
  const threadRootId = useThreadRootEvent(room, threadId);
  const scheduledStatus = useThreadScheduledStatus(room, threadRootId);
  const { scheduledTaskCount } = scheduledStatus;
  const scheduledDisplay = getThreadScheduledDisplay(
    scheduledTaskCount,
    scheduledStatus.nextScheduledTs
  );

  return {
    scheduledTaskCount,
    ...scheduledDisplay,
  };
};
