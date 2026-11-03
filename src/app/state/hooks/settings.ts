import { useCallback, useMemo } from 'react';
import { type WritableAtom, useAtomValue, useStore } from 'jotai';
import { selectAtom } from 'jotai/utils';

export type SettingSetter<V> = (value: V | ((current: V) => V)) => void;

/**
 * One field of a settings atom (the generic settings or MindRoom's) and a setter that changes
 * only that field. The write result `R` is a type parameter because jotai atom types are
 * invariant in it: an atom whose write returns `undefined` is not a `WritableAtom<T, [T], void>`.
 */
export const useSetting = <T extends object, K extends keyof T, R = void>(
  settingsAtom: WritableAtom<T, [T], R>,
  key: K
): [T[K], SettingSetter<T[K]>] => {
  const store = useStore();
  const valueAtom = useMemo(
    () => selectAtom(settingsAtom, (settings) => settings[key]),
    [settingsAtom, key]
  );
  const value = useAtomValue(valueAtom);

  const setValue = useCallback<SettingSetter<T[K]>>(
    (next) => {
      const current = store.get(settingsAtom);
      const resolved =
        typeof next === 'function' ? (next as (value: T[K]) => T[K])(current[key]) : next;
      if (Object.is(resolved, current[key])) return;
      store.set(settingsAtom, { ...current, [key]: resolved });
    },
    [store, settingsAtom, key]
  );

  return [value, setValue];
};
