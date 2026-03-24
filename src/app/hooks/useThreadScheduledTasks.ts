import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../types/matrix/room';
import { parseScheduledTaskStateEvent } from '../utils/scheduledTaskContract';
import { useStateEvents } from './useStateEvents';

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number => {
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);

  return useMemo(() => {
    if (!threadRootId) return 0;

    let pendingTaskCount = 0;

    scheduledTaskEvents.forEach((event) => {
      const parsedTask = parseScheduledTaskStateEvent(event);
      if (!parsedTask) return;
      if (parsedTask.status !== 'pending') return;
      if (parsedTask.threadId !== threadRootId) return;
      if (parsedTask.newThread) return;

      pendingTaskCount += 1;
    });

    return pendingTaskCount;
  }, [scheduledTaskEvents, threadRootId]);
};
