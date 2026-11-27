import { useEffect, useMemo, useState } from 'react';
import { useAppLanguageCode } from './useAppLanguageCode';
import { subscribeRelativeTimeClock } from '../lib/hooks/useLiveClock';
import {
  daysToMs,
  formatCompactRelativeTime,
  formatRelativeTime,
  hoursToMs,
  minutesToMs,
  secondsToMs,
} from '../lib/time';

export { subscribeRelativeTimeClock };

export const getRelativeTimeUpdateInterval = (
  ts: number,
  now = Date.now(),
  format: 'relative' | 'compact' = 'relative'
): number => {
  const ageMs = Math.max(0, now - ts);

  if (format === 'compact') {
    if (ageMs < secondsToMs(60)) return Math.max(1, secondsToMs(60) - ageMs);
    if (ageMs < hoursToMs(1)) return secondsToMs(10);
    if (ageMs < daysToMs(1)) return minutesToMs(1);
    if (ageMs < daysToMs(7)) return minutesToMs(5);
    return -1;
  }

  if (ageMs < secondsToMs(60)) return secondsToMs(1);
  if (ageMs < hoursToMs(1)) return secondsToMs(10);
  if (ageMs < daysToMs(1)) return minutesToMs(1);
  return minutesToMs(5);
};

// `relative` reads "2d ago"; `compact` drops the suffix ("2d") and shows a date after a week.
export const useRelativeTime = (
  ts: number | undefined,
  format: 'relative' | 'compact' = 'relative'
): string => {
  const language = useAppLanguageCode();
  const formatTime = format === 'compact' ? formatCompactRelativeTime : formatRelativeTime;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
  }, [ts]);

  const intervalMs = useMemo(
    () => (ts === undefined ? -1 : getRelativeTimeUpdateInterval(ts, now, format)),
    [format, ts, now]
  );
  const relativeTime = ts === undefined ? '' : formatTime(ts, language);

  useEffect(() => {
    if (intervalMs < 0 || ts === undefined) return undefined;
    // Compact displays "now" under 60 s: wake once at the 60 s boundary instead of ticking every 1 s.
    if (format === 'compact' && Math.max(0, Date.now() - ts) < secondsToMs(60)) {
      const delayMs = Math.max(1, secondsToMs(60) - Math.max(0, Date.now() - ts));
      const timeoutId = window.setTimeout(() => setNow(Date.now()), delayMs);
      return () => window.clearTimeout(timeoutId);
    }

    return subscribeRelativeTimeClock(intervalMs, () => {
      // Large compact rooms can have hundreds of cards on the same clock.
      // Most ticks do not change their minute/hour label; avoid rerendering
      // the entire card until its visible text or clock cadence changes.
      if (
        formatTime(ts, language) !== relativeTime ||
        getRelativeTimeUpdateInterval(ts, Date.now(), format) !== intervalMs
      ) {
        setNow(Date.now());
      }
    });
  }, [format, formatTime, intervalMs, language, relativeTime, ts]);

  return relativeTime;
};
