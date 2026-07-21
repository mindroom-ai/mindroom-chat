import { useEffect, useMemo, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  getRoomThreadScheduledStatusResolver,
  type ThreadScheduledStatus,
} from './threadScheduledStatus';
import { getScheduledTimeUpdateInterval } from './compactThreadCardUtils';

const MAX_TIMEOUT_MS = 2_147_483_647;

const getEarliestScheduledTs = (
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>
): number | undefined => {
  let earliestTs: number | undefined;
  scheduledStatusMap.forEach(({ nextScheduledTs }) => {
    if (
      nextScheduledTs !== undefined &&
      (earliestTs === undefined || nextScheduledTs < earliestTs)
    ) {
      earliestTs = nextScheduledTs;
    }
  });
  return earliestTs;
};

const getEarliestScheduledRefreshTs = (
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>
): number | undefined => {
  let earliestTs: number | undefined;
  scheduledStatusMap.forEach(({ nextScheduledRefreshTs, nextScheduledTs }) => {
    const refreshTs = nextScheduledTs ?? nextScheduledRefreshTs;
    if (refreshTs !== undefined && (earliestTs === undefined || refreshTs < earliestTs)) {
      earliestTs = refreshTs;
    }
  });
  return earliestTs;
};

const hasDeferredCronEvaluation = (
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>
): boolean => {
  for (const scheduledStatus of scheduledStatusMap.values()) {
    if (scheduledStatus.hasDeferredCronEvaluation === true) return true;
  }
  return false;
};

export const useRoomThreadScheduledStatusMap = (
  room: Room,
  scheduledTaskEvents: readonly MatrixEvent[],
  enabled: boolean,
  refreshSignal: number,
  refreshDisplayCadence = true
): Map<string, ThreadScheduledStatus> => {
  const [clockVersion, setClockVersion] = useState(0);
  const resolver = getRoomThreadScheduledStatusResolver(room);
  const scheduledStatusMap = useMemo(() => {
    void clockVersion;
    void refreshSignal;
    return enabled
      ? resolver.resolve(scheduledTaskEvents, Date.now(), undefined, refreshSignal)
      : new Map<string, ThreadScheduledStatus>();
  }, [clockVersion, enabled, refreshSignal, resolver, scheduledTaskEvents]);
  const earliestScheduledTs = useMemo(
    () => getEarliestScheduledTs(scheduledStatusMap),
    [scheduledStatusMap]
  );
  const earliestScheduledRefreshTs = useMemo(
    () => getEarliestScheduledRefreshTs(scheduledStatusMap),
    [scheduledStatusMap]
  );
  const hasDeferredEvaluation = useMemo(
    () => hasDeferredCronEvaluation(scheduledStatusMap),
    [scheduledStatusMap]
  );

  useEffect(() => {
    let delayMs: number;
    if (hasDeferredEvaluation) {
      delayMs = 1;
    } else {
      if (earliestScheduledRefreshTs === undefined) return undefined;
      const now = Date.now();
      const occurrenceDelayMs = Math.max(1, earliestScheduledRefreshTs - now);
      const displayDelayMs =
        refreshDisplayCadence && earliestScheduledTs !== undefined
          ? Math.max(1, getScheduledTimeUpdateInterval(earliestScheduledTs, now))
          : MAX_TIMEOUT_MS;
      delayMs = Math.min(occurrenceDelayMs, displayDelayMs, MAX_TIMEOUT_MS);
    }
    const timeoutId = globalThis.setTimeout(() => {
      setClockVersion((version) => version + 1);
    }, delayMs);
    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [
    clockVersion,
    earliestScheduledRefreshTs,
    earliestScheduledTs,
    hasDeferredEvaluation,
    refreshDisplayCadence,
  ]);

  return scheduledStatusMap;
};
