import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useStateEvents } from '../../hooks/useStateEvents';
import { getRoomScheduledTaskCounts } from './roomThreadOverviewModel';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number => {
  const scheduledTaskEvents = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);

  return useMemo(() => {
    if (!threadRootId) return 0;
    const counts = getRoomScheduledTaskCounts(scheduledTaskEvents);
    return counts.get(threadRootId) ?? 0;
  }, [scheduledTaskEvents, threadRootId]);
};
