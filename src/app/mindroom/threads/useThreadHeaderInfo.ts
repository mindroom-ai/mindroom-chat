import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getThreadScheduledDisplayText } from './compactThreadCardUtils';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadScheduledStatus } from './useThreadScheduledStatus';

export type ThreadHeaderInfo = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  cronDescription?: string;
  scheduledDisplayText?: string;
};

export const useThreadHeaderInfo = (room: Room, threadId: string | undefined): ThreadHeaderInfo => {
  const threadRootId = useThreadRootEvent(room, threadId);
  const scheduledStatus = useThreadScheduledStatus(room, threadRootId);
  const { scheduledTaskCount, nextScheduledTs } = scheduledStatus;
  const scheduledDisplayText = getThreadScheduledDisplayText(
    scheduledTaskCount,
    nextScheduledTs,
    scheduledStatus.cronDescription
  );

  return {
    scheduledTaskCount,
    nextScheduledTs,
    cronDescription: scheduledStatus.cronDescription,
    scheduledDisplayText,
  };
};
