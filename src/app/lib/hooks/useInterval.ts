import { useEffect, useRef } from 'react';

/** Calls `callback` every `ms` milliseconds; a negative `ms` pauses the interval. */
export const useInterval = (callback: () => void, ms: number): void => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (ms < 0) return undefined;
    const id = setInterval(() => callbackRef.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
};
