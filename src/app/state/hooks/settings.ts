import { useCallback, useMemo } from 'react';
import { type WritableAtom, useAtomValue, useStore } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { Settings } from '../settings';

export type SettingSetter<K extends keyof Settings> = (
  value: Settings[K] | ((current: Settings[K]) => Settings[K])
) => void;

/** One field of the settings atom and a setter that changes only that field. */
export const useSetting = <K extends keyof Settings>(
  settingsAtom: WritableAtom<Settings, [Settings], void>,
  key: K
): [Settings[K], SettingSetter<K>] => {
  const store = useStore();
  const valueAtom = useMemo(
    () => selectAtom(settingsAtom, (settings) => settings[key]),
    [settingsAtom, key]
  );
  const value = useAtomValue(valueAtom);

  const setValue = useCallback<SettingSetter<K>>(
    (next) => {
      const current = store.get(settingsAtom);
      const resolved =
        typeof next === 'function'
          ? (next as (value: Settings[K]) => Settings[K])(current[key])
          : next;
      if (Object.is(resolved, current[key])) return;
      store.set(settingsAtom, { ...current, [key]: resolved });
    },
    [store, settingsAtom, key]
  );

  return [value, setValue];
};
