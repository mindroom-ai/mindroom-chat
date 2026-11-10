import { useState } from 'react';
import { useInterval } from './useInterval';

const MINUTE_MS = 60_000;

/** The time, refreshed every minute, for views whose content goes stale with the clock. */
export const useMinuteClock = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), MINUTE_MS);
  return now;
};
