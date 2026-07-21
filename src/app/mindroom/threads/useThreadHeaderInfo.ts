import type { Room } from 'matrix-js-sdk/lib/models/room';
import { formatScheduledTime } from './compactThreadCardUtils';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadScheduledStatus } from './useThreadScheduledStatus';

export type ThreadHeaderInfo = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
};

export const getThreadHeaderScheduledDisplayText = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  cronDescription?: string
): string | undefined => {
  if (nextScheduledTs !== undefined) return formatScheduledTime(nextScheduledTs);
  if (scheduledTaskCount === 1 && cronDescription) return cronDescription;
  if (scheduledTaskCount <= 0) return undefined;
  return `${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`;
};

export const useThreadHeaderInfo = (room: Room, threadId: string | undefined): ThreadHeaderInfo => {
  const threadRootId = useThreadRootEvent(room, threadId);
  const scheduledStatus = useThreadScheduledStatus(room, threadRootId);
  const { scheduledTaskCount, nextScheduledTs } = scheduledStatus;
  const scheduledDisplayText = getThreadHeaderScheduledDisplayText(
    scheduledTaskCount,
    nextScheduledTs,
    scheduledStatus.cronDescription
  );

  return {
    scheduledTaskCount,
    nextScheduledTs,
    scheduledDisplayText,
  };
};
