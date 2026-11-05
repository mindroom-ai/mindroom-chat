import { useRef, type MutableRefObject } from 'react';

/**
 * A ref that holds the value of the newest render, for callbacks and effects that must keep their
 * identity (or not run again) when the value changes.
 */
export const useLatestRef = <T>(value: T): MutableRefObject<T> => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};
