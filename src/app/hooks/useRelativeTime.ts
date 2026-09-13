import { useCallback, useEffect, useMemo, useState } from 'react';
import { daysToMs, formatRelativeTime, hoursToMs, minutesToMs, secondsToMs } from '../utils/time';
import { useInterval } from './useInterval';

export const getRelativeTimeUpdateInterval = (ts: number, now = Date.now()): number => {
  const ageMs = Math.max(0, now - ts);

  if (ageMs < secondsToMs(60)) return secondsToMs(1);
  if (ageMs < hoursToMs(1)) return secondsToMs(10);
  if (ageMs < daysToMs(1)) return minutesToMs(1);
  return minutesToMs(5);
};

export const useRelativeTime = (ts: number | undefined): string => {
  const [now, setNow] = useState(() => Date.now());
  const tick = useCallback(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    setNow(Date.now());
  }, [ts]);

  const intervalMs = useMemo(
    () => (ts === undefined ? -1 : getRelativeTimeUpdateInterval(ts, now)),
    [ts, now]
  );

  useInterval(tick, intervalMs);

  if (ts === undefined) return '';

  return formatRelativeTime(ts);
};
