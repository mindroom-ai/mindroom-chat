import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvents } from './useStateEvents';
import { getRoomScheduledTaskCounts } from '../features/room/roomThreadOverviewModel';

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number => {
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);

  return useMemo(() => {
    if (!threadRootId) return 0;
    const counts = getRoomScheduledTaskCounts(scheduledTaskEvents);
    return counts.get(threadRootId) ?? 0;
  }, [scheduledTaskEvents, threadRootId]);
};
