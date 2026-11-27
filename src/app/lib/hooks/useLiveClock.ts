import { useEffect, useState } from 'react';

type RelativeTimeClockListener = () => void;

type RelativeTimeClock = {
  listeners: Set<RelativeTimeClockListener>;
  intervalId?: number;
};

const relativeTimeClocks = new Map<number, RelativeTimeClock>();
let listeningVisibility = false;

const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;

const startClock = (intervalMs: number, clock: RelativeTimeClock) => {
  if (clock.intervalId !== undefined || isHidden()) return;
  clock.intervalId = window.setInterval(() => {
    clock.listeners.forEach((currentListener) => currentListener());
  }, intervalMs);
};

const stopClock = (clock: RelativeTimeClock) => {
  if (clock.intervalId === undefined) return;
  window.clearInterval(clock.intervalId);
  clock.intervalId = undefined;
};

const onVisibilityChange = () => {
  if (isHidden()) {
    relativeTimeClocks.forEach(stopClock);
    return;
  }
  relativeTimeClocks.forEach((clock, intervalMs) => {
    startClock(intervalMs, clock);
    clock.listeners.forEach((currentListener) => currentListener());
  });
};

const syncVisibilityListener = () => {
  if (typeof document === 'undefined') return;
  if (relativeTimeClocks.size > 0 && !listeningVisibility) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    listeningVisibility = true;
  } else if (relativeTimeClocks.size === 0 && listeningVisibility) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    listeningVisibility = false;
  }
};

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
 * Calls `listener` every `intervalMs` on one timer that every listener of that interval shares,
 * pausing while `document.hidden` is true and syncing once when returning to visible.
 * Returns a function that unsubscribes it.
 */
export const subscribeRelativeTimeClock = (
  intervalMs: number,
  listener: RelativeTimeClockListener
): (() => void) => {
  const clock = getRelativeTimeClock(intervalMs);
  clock.listeners.add(listener);
  syncVisibilityListener();
  startClock(intervalMs, clock);

  return () => {
    const currentClock = relativeTimeClocks.get(intervalMs);
    if (!currentClock) return;

    currentClock.listeners.delete(listener);
    if (currentClock.listeners.size > 0) return;

    stopClock(currentClock);
    relativeTimeClocks.delete(intervalMs);
    syncVisibilityListener();
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
