import { useEffect, useMemo, useState } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import { getThreadScheduledTaskCountStatus } from './threadScheduledStatus';
import { useStateEvents } from './useStateEvents';

const MAX_TIMEOUT_MS = 2_147_483_647;

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number => {
  const scheduledTaskEvents = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const countStatus = useMemo(() => {
    void refreshVersion;
    return getThreadScheduledTaskCountStatus(scheduledTaskEvents, threadRootId, Date.now());
  }, [scheduledTaskEvents, threadRootId, refreshVersion]);

  useEffect(() => {
    const refreshTs = countStatus.nextScheduledRefreshTs;
    if (refreshTs === undefined) return undefined;

    const remainingMs = refreshTs - Date.now();
    const delayMs = remainingMs <= 0 ? 1 : Math.min(Math.max(1, remainingMs + 1), MAX_TIMEOUT_MS);
    const timeoutId = globalThis.setTimeout(() => {
      setRefreshVersion((version) => version + 1);
    }, delayMs);
    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [countStatus.nextScheduledRefreshTs, refreshVersion]);

  return countStatus.scheduledTaskCount;
};
