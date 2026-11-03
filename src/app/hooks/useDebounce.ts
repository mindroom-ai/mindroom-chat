import { useCallback, useEffect, useRef } from 'react';

export type DebounceOptions = {
  /** Milliseconds without a call before the callback runs. */
  wait?: number;
  /** Run on the first call of a burst instead of after it. */
  immediate?: boolean;
};

/**
 * A function that runs `callback` once calls stop for `wait` milliseconds, with the arguments
 * of the last call. The function changes with `callback`, so effects that list it run again
 * when what it does changes; a pending call carries over to the new function.
 */
export function useDebounce<A extends unknown[]>(
  callback: (...args: A) => void,
  options?: DebounceOptions
): (...args: A) => void {
  const { wait = 200, immediate = false } = options ?? {};
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    },
    []
  );

  return useCallback(
    (...args: A) => {
      const burstStarted = timeoutRef.current === undefined;
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
      if (immediate && burstStarted) callback(...args);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined;
        if (!immediate) callback(...args);
      }, wait);
    },
    [callback, wait, immediate]
  );
}
