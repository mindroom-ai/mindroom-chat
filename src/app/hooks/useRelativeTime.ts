import { useEffect, useMemo, useState } from 'react';
import { daysToMs, formatRelativeTime, hoursToMs, minutesToMs, secondsToMs } from '../utils/time';

type RelativeTimeClockListener = () => void;

type RelativeTimeClock = {
  listeners: Set<RelativeTimeClockListener>;
  intervalId?: number;
};

const relativeTimeClocks = new Map<number, RelativeTimeClock>();

const getRelativeTimeClock = (intervalMs: number): RelativeTimeClock => {
  const existingClock = relativeTimeClocks.get(intervalMs);
  if (existingClock) return existingClock;

  const nextClock: RelativeTimeClock = {
    listeners: new Set<RelativeTimeClockListener>(),
  };
  relativeTimeClocks.set(intervalMs, nextClock);

  return nextClock;
};

const subscribeRelativeTimeClock = (
  intervalMs: number,
  listener: RelativeTimeClockListener
): (() => void) => {
  const clock = getRelativeTimeClock(intervalMs);
  clock.listeners.add(listener);

  if (clock.intervalId === undefined) {
    clock.intervalId = window.setInterval(() => {
      clock.listeners.forEach((currentListener) => currentListener());
    }, intervalMs);
  }

  return () => {
    const currentClock = relativeTimeClocks.get(intervalMs);
    if (!currentClock) return;

    currentClock.listeners.delete(listener);
    if (currentClock.listeners.size > 0) return;

    window.clearInterval(currentClock.intervalId);
    relativeTimeClocks.delete(intervalMs);
  };
};

export const getRelativeTimeUpdateInterval = (ts: number, now = Date.now()): number => {
  const ageMs = Math.max(0, now - ts);

  if (ageMs < secondsToMs(60)) return secondsToMs(1);
  if (ageMs < hoursToMs(1)) return secondsToMs(10);
  if (ageMs < daysToMs(1)) return minutesToMs(1);
  return minutesToMs(5);
};

export const useRelativeTime = (ts: number | undefined): string => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
  }, [ts]);

  const intervalMs = useMemo(
    () => (ts === undefined ? -1 : getRelativeTimeUpdateInterval(ts, now)),
    [ts, now]
  );

  useEffect(() => {
    if (intervalMs < 0) return undefined;

    return subscribeRelativeTimeClock(intervalMs, () => {
      setNow(Date.now());
    });
  }, [intervalMs]);

  if (ts === undefined) return '';

  return formatRelativeTime(ts);
};
