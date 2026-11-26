import { useEffect, useState } from 'react';

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

/**
 * Calls `listener` every `intervalMs` on one timer that every listener of that interval shares.
 * Returns a function that unsubscribes it.
 */
export const subscribeRelativeTimeClock = (
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

/**
 * Current Unix milliseconds, ticking on the shared 1-second clock only while `active` is true.
 * Reads a fresh timestamp immediately when `active` flips to true so an idle row never flashes a
 * stale value.
 */
export const useLiveClock = (active: boolean): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    return subscribeRelativeTimeClock(1_000, () => setNow(Date.now()));
  }, [active]);
  return active ? Date.now() : now;
};
