import type { WritableAtom } from 'jotai';
import { useSetting } from './useSetting';

/** One field of a settings atom, for components that read it and never write it back. */
export const useSettingValue = <T extends object, K extends keyof T, R = void>(
  settingsAtom: WritableAtom<T, [T], R>,
  key: K
): T[K] => useSetting(settingsAtom, key)[0];
