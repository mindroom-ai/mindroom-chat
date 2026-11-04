import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

/**
 * Per-view values of the room timeline. The timeline stays mounted while the reader moves between
 * rooms and threads, so a value that belongs to the room or thread on screen carries the key of
 * that view and starts over in the render that shows another one.
 */

/** A value read by callbacks that must keep their identity when it changes. */
export const useLatestRef = <T>(value: T): MutableRefObject<T> => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

export type ViewScopedFlag = { viewKey: string; value: boolean };

/**
 * A flag that belongs to one view: switching rooms or threads clears it in that render. Read and
 * set `current.value`; callbacks holding the ref see the flag of the view shown now.
 */
export const useViewScopedFlag = (viewKey: string): MutableRefObject<ViewScopedFlag> => {
  const flagRef = useRef<ViewScopedFlag>({ viewKey, value: false });
  if (flagRef.current.viewKey !== viewKey) flagRef.current = { viewKey, value: false };
  return flagRef;
};

type Scoped<T> = { viewKey: string; value: T };

const applyUpdate = <T>(next: SetStateAction<T>, previous: T): T =>
  // Like React's own state, a function is an updater, so `T` itself is never a function.
  typeof next === 'function' ? (next as (value: T) => T)(previous) : next;

/**
 * State that belongs to one view. The render that shows another view reads that view's value with
 * `init`, so nothing of the previous view shows for even one commit, and an update meant for a
 * view no longer shown is dropped.
 */
export const useViewScopedState = <T>(
  viewKey: string,
  init: () => T
): [T, Dispatch<SetStateAction<T>>] => {
  const [state, setState] = useState<Scoped<T>>(() => ({ viewKey, value: init() }));
  let current = state;
  if (state.viewKey !== viewKey) {
    current = { viewKey, value: init() };
    setState(current);
  }
  const shownKey = current.viewKey;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setState((previous) =>
        previous.viewKey === shownKey
          ? { viewKey: shownKey, value: applyUpdate(next, previous.value) }
          : previous
      ),
    [shownKey]
  );
  return [current.value, setValue];
};
