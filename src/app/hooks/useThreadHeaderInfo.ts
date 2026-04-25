import { useCallback, useMemo, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../types/matrix/room';
import {
  formatScheduledTime,
  getScheduledTimeUpdateInterval,
} from '../mindroom/threads/compactThreadCardUtils';
import { useThreadRootEvent } from '../mindroom/threads/useThreadRootEvent';
import { parseScheduledTaskStateEvent } from '../utils/scheduledTaskContract';
import { useInterval } from './useInterval';
import { useStateEvents } from './useStateEvents';
import { useThreadScheduledTasks } from './useThreadScheduledTasks';

export type ThreadHeaderInfo = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
};

export const getNextThreadScheduledTs = (
  scheduledTaskEvents: MatrixEvent[],
  threadRootId: string | undefined,
  now = Date.now()
): number | undefined => {
  if (!threadRootId) return undefined;

  let nextTs: number | undefined;

  scheduledTaskEvents.forEach((event) => {
    const parsedTask = parseScheduledTaskStateEvent(event);
    if (!parsedTask) return;
    if (parsedTask.status !== 'pending') return;
    if (parsedTask.threadId !== threadRootId || parsedTask.newThread) return;
    if (!parsedTask.executeAt) return;

    const executeAtTs = Date.parse(parsedTask.executeAt);
    if (!Number.isFinite(executeAtTs) || executeAtTs <= now) return;

    if (nextTs === undefined || executeAtTs < nextTs) {
      nextTs = executeAtTs;
    }
  });

  return nextTs;
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
  const scheduledTaskCount = useThreadScheduledTasks(room, threadRootId);
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);
  const [, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);
  const nextScheduledTs = useMemo(
    () => getNextThreadScheduledTs(scheduledTaskEvents, threadRootId),
    [scheduledTaskEvents, threadRootId]
  );
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
