import { useCallback, useEffect, useRef } from 'react';

export type ThrottleOptions = {
  /** Milliseconds between runs. */
  wait?: number;
  /** Run on the first call instead of only at the end of the interval. */
  immediate?: boolean;
};

/**
 * A stable function that runs the latest `callback` at most once per `wait` milliseconds, with
 * the arguments of the last call in the interval.
 */
export function useThrottle<A extends unknown[]>(
  callback: (...args: A) => void,
  options?: ThrottleOptions
): (...args: A) => void {
  const { wait = 200, immediate = false } = options ?? {};
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const argsRef = useRef<A>();

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    },
    []
  );

  return useCallback(
    (...args: A) => {
      argsRef.current = args;
      if (timeoutRef.current !== undefined) return;
      if (immediate) {
        argsRef.current = undefined;
        callbackRef.current(...args);
      }
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined;
        const lastArgs = argsRef.current;
        argsRef.current = undefined;
        if (lastArgs) callbackRef.current(...lastArgs);
      }, wait);
    },
    [wait, immediate]
  );
}
