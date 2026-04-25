import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useStateEvents } from './useStateEvents';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import {
  buildRoomThreadScheduledStatusMap,
  getThreadScheduledStatus,
} from './threadScheduledStatus';

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number => {
  const scheduledTaskEvents = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);

  return useMemo(() => {
    if (!threadRootId) return 0;
    const statusMap = buildRoomThreadScheduledStatusMap(scheduledTaskEvents);
    return getThreadScheduledStatus(statusMap, threadRootId).scheduledTaskCount;
  }, [scheduledTaskEvents, threadRootId]);
};
