import { atom, WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { spaceOrderStorageKey } from '../preferences/accountStorageKeys';

export type SpaceOrderState = string[];

export type SpaceOrderAction = {
  type: 'REORDER';
  order: string[];
};

export type SpaceOrderAtom = WritableAtom<SpaceOrderState, [SpaceOrderAction], undefined>;

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((id): id is string => {
    if (typeof id !== 'string' || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const readStringArray = (key: string): string[] =>
  uniqueStrings(getLocalStorageItem<unknown>(key, []));

export const makeSpaceOrderAtom = (userId: string): SpaceOrderAtom => {
  const baseSpaceOrderAtom = atomWithLocalStorage<SpaceOrderState>(
    spaceOrderStorageKey(userId),
    readStringArray,
    setLocalStorageItem
  );

  return atom<SpaceOrderState, [SpaceOrderAction], undefined>(
    (get) => get(baseSpaceOrderAtom),
    (_get, set, action) => {
      set(baseSpaceOrderAtom, uniqueStrings(action.order));
    }
  );
};

// One local order atom per account, made once, so the rail and Home share live reorders.
const spaceOrderAtoms = new Map<string, SpaceOrderAtom>();
export const spaceOrderAtomFor = (userId: string): SpaceOrderAtom => {
  let orderAtom = spaceOrderAtoms.get(userId);
  if (!orderAtom) {
    orderAtom = makeSpaceOrderAtom(userId);
    spaceOrderAtoms.set(userId, orderAtom);
  }
  return orderAtom;
};
