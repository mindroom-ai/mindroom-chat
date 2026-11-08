import { atom, WritableAtom } from 'jotai';
import { produce } from 'immer';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';

export type SpaceOrderState = string[];

export type SpaceOrderAction =
  | {
      type: 'REORDER';
      order: string[];
    }
  | {
      type: 'REMOVE';
      id: string;
    };

export type SpaceOrderAtom = WritableAtom<SpaceOrderState, [SpaceOrderAction], undefined>;

export const SPACE_ORDER_STORAGE_KEY_PREFIX = 'mindroom.sidebar.spaceOrder:';

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((id): id is string => {
    if (typeof id !== 'string' || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const readStringArray = (key: string): string[] => uniqueStrings(getLocalStorageItem<unknown>(key, []));

const writeStringArray = (key: string, value: string[]) => {
  setLocalStorageItem(key, uniqueStrings(value));
};

export const makeSpaceOrderAtom = (userId: string): SpaceOrderAtom => {
  const storeKey = `${SPACE_ORDER_STORAGE_KEY_PREFIX}${userId}`;
  const baseSpaceOrderAtom = atomWithLocalStorage<SpaceOrderState>(
    storeKey,
    readStringArray,
    writeStringArray
  );

  return atom<SpaceOrderState, [SpaceOrderAction], undefined>(
    (get) => get(baseSpaceOrderAtom),
    (get, set, action) => {
      if (action.type === 'REORDER') {
        set(baseSpaceOrderAtom, uniqueStrings(action.order));
        return;
      }

      if (action.type === 'REMOVE') {
        set(
          baseSpaceOrderAtom,
          produce(get(baseSpaceOrderAtom), (draft) => {
            const index = draft.indexOf(action.id);
            if (index >= 0) draft.splice(index, 1);
          })
        );
      }
    }
  );
};
