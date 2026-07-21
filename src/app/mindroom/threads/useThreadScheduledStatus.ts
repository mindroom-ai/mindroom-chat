import { useEffect, useMemo, useState } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import {
  getRoomThreadScheduledStatusResolver,
  getThreadScheduledStatus,
  type ThreadScheduledStatus,
} from './threadScheduledStatus';
import { getScheduledTimeUpdateInterval } from './compactThreadCardUtils';
import { useStateEvents } from './useStateEvents';

const MAX_TIMEOUT_MS = 2_147_483_647;

export const useThreadScheduledStatus = (
  room: Room,
  threadRootId: string | undefined
): ThreadScheduledStatus => {
  const scheduledTaskEvents = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const resolver = getRoomThreadScheduledStatusResolver(room);

  const scheduledStatus = useMemo(() => {
    // Timer ticks should refresh the caller-owned time used for scheduled-status derivation.
    void refreshVersion;
    const now = Date.now();
    return getThreadScheduledStatus(
      resolver.resolve(scheduledTaskEvents, now, threadRootId),
      threadRootId
    );
  }, [scheduledTaskEvents, threadRootId, refreshVersion, resolver]);

  useEffect(() => {
    let delayMs: number;
    if (scheduledStatus.hasDeferredCronEvaluation) {
      delayMs = 1;
    } else {
      const refreshTs = scheduledStatus.nextScheduledTs ?? scheduledStatus.nextScheduledRefreshTs;
      if (refreshTs === undefined) return undefined;
      const now = Date.now();
      const remainingMs = refreshTs - now;
      const cadenceMs =
        scheduledStatus.nextScheduledTs === undefined
          ? remainingMs
          : getScheduledTimeUpdateInterval(refreshTs, now);
      delayMs =
        remainingMs <= 0 ? 1 : Math.min(cadenceMs, Math.max(1, remainingMs + 1), MAX_TIMEOUT_MS);
    }
    const timeoutId = globalThis.setTimeout(() => {
      setRefreshVersion((version) => version + 1);
    }, delayMs);
    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [
    refreshVersion,
    scheduledStatus.hasDeferredCronEvaluation,
    scheduledStatus.nextScheduledRefreshTs,
    scheduledStatus.nextScheduledTs,
  ]);

  return scheduledStatus;
};
