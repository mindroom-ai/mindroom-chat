import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../types/matrix/room';
import { parseScheduledTaskStateEvent } from '../utils/scheduledTaskContract';
import { useStateEvents } from './useStateEvents';

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number => {
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);

  return useMemo(() => {
    if (!threadRootId) return 0;

    const now = new Date();
    let pendingTaskCount = 0;

    scheduledTaskEvents.forEach((event) => {
      const parsedTask = parseScheduledTaskStateEvent(event);
      if (!parsedTask) return;
      if (parsedTask.status !== 'pending') return;
      if (parsedTask.threadId !== threadRootId) return;
      if (parsedTask.newThread) return;

      // Only count tasks that haven't fired yet
      if (parsedTask.executeAt) {
        const executeAtDate = new Date(parsedTask.executeAt);
        if (executeAtDate <= now) return;
      }

      pendingTaskCount += 1;
    });

    return pendingTaskCount;
  }, [scheduledTaskEvents, threadRootId]);
};
