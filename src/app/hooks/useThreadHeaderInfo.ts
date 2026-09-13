import { useCallback, useEffect, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { StateEvent } from '../../types/matrix/room';
import {
  findLatestThreadSummaryEvent,
  getLatestThreadSummaryInfo,
} from '../components/message/mindroomThreadSummary';
import {
  formatScheduledTime,
  getScheduledTimeUpdateInterval,
} from '../features/room/compactThreadCardUtils';
import { useThreadRootEvent } from '../features/room/useThreadRootEvent';
import { parseScheduledTaskStateEvent } from '../utils/scheduledTaskContract';
import { useInterval } from './useInterval';
import { useStateEvents } from './useStateEvents';
import { useThreadEventRefresh } from './useThreadEventRefresh';
import { useThreadScheduledTasks } from './useThreadScheduledTasks';

type ThreadLike =
  | {
      rootEvent?: MatrixEvent;
      events?: MatrixEvent[];
      timeline?: MatrixEvent[];
    }
  | null
  | undefined;

export type ThreadHeaderInfo = {
  summaryText?: string;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
};

const getPreferredThreadReplyEvents = (thread: ThreadLike): MatrixEvent[] => {
  if (thread?.events?.length) return thread.events;
  if (thread?.timeline?.length) return thread.timeline;
  return thread?.events ?? thread?.timeline ?? [];
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

  const thread = threadRootId ? room.getThread(threadRootId) ?? undefined : undefined;
  const replyEvents = getPreferredThreadReplyEvents(thread);
  const summaryInfo = getLatestThreadSummaryInfo(replyEvents);
  const summaryEvent = findLatestThreadSummaryEvent(replyEvents);

  const nextScheduledTs = getNextThreadScheduledTs(scheduledTaskEvents, threadRootId);
  const scheduledDisplayText = getThreadHeaderScheduledDisplayText(
    scheduledTaskCount,
    nextScheduledTs
  );
  const intervalMs =
    nextScheduledTs === undefined ? -1 : getScheduledTimeUpdateInterval(nextScheduledTs);

  useEffect(() => {
    if (!threadRootId || thread) return undefined;

    const handleThreadCreate = () => {
      if (room.getThread(threadRootId)) {
        refresh();
      }
    };

    room.on(ThreadEvent.New, handleThreadCreate);

    return () => {
      room.removeListener(ThreadEvent.New, handleThreadCreate);
    };
  }, [refresh, room, thread, threadRootId]);

  useThreadEventRefresh(thread, [thread?.rootEvent, summaryEvent], refresh);
  useInterval(refresh, intervalMs);

  return {
    summaryText: summaryInfo?.summaryText,
    scheduledTaskCount,
    nextScheduledTs,
    scheduledDisplayText,
  };
};
