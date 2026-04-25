import { useCallback, useMemo, useState } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  formatScheduledTime,
  getScheduledTimeUpdateInterval,
} from './compactThreadCardUtils';
import { useThreadRootEvent } from './useThreadRootEvent';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import { useInterval } from '../../hooks/useInterval';
import { useStateEvents } from './useStateEvents';
import {
  buildRoomThreadScheduledStatusMap,
  getThreadScheduledStatus,
} from './threadScheduledStatus';

export { getNextThreadScheduledTs } from './threadScheduledStatus';

export type ThreadHeaderInfo = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
};

export const getThreadHeaderScheduledDisplayText = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined
): string | undefined => {
  if (nextScheduledTs !== undefined) return formatScheduledTime(nextScheduledTs);
  if (scheduledTaskCount <= 0) return undefined;
  return `${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`;
};

export const useThreadHeaderInfo = (
  room: Room,
  threadId: string | undefined
): ThreadHeaderInfo => {
  const threadRootId = useThreadRootEvent(room, threadId);
  const scheduledTaskEvents = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);
  const [, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);
  const scheduledStatus = useMemo(
    () =>
      getThreadScheduledStatus(
        buildRoomThreadScheduledStatusMap(scheduledTaskEvents),
        threadRootId
      ),
    [scheduledTaskEvents, threadRootId]
  );
  const { scheduledTaskCount, nextScheduledTs } = scheduledStatus;
  const scheduledDisplayText = getThreadHeaderScheduledDisplayText(scheduledTaskCount, nextScheduledTs);
  const intervalMs =
    nextScheduledTs === undefined ? -1 : getScheduledTimeUpdateInterval(nextScheduledTs);
  useInterval(refresh, intervalMs);

  return {
    scheduledTaskCount,
    nextScheduledTs,
    scheduledDisplayText,
  };
};
