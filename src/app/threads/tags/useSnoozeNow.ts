import { useEffect, useState } from 'react';
import { nextSnoozeWakeTs } from '../../event-store/threads/threadSnooze';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** `Date.now()`, renewed when the earliest future `until` passes. */
export const useSnoozeNow = (untilTsList: Iterable<number | undefined>): number => {
  const [now, setNow] = useState(() => Date.now());
  const wakeTs = nextSnoozeWakeTs(untilTsList, now);

  useEffect(() => {
    if (wakeTs === undefined) return undefined;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(wakeTs - Date.now(), MAX_TIMEOUT_MS))
    );
    return () => clearTimeout(timer);
  }, [wakeTs]);

  return now;
};
