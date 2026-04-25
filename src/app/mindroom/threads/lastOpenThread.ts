import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { getActiveSession } from '../../state/sessions';
import { getImperativeJotaiStore } from '../../state/jotaiStore';

const LAST_OPEN_THREAD = 'lastOpenThread';

type LastOpenThreadAction =
  | {
      type: 'PUT';
      roomId: string;
      threadId: string;
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

type LastOpenThreadAtom = WritableAtom<Map<string, string>, [LastOpenThreadAction], undefined>;

const getStoreKey = (userId: string): string => `${LAST_OPEN_THREAD}${userId}`;

let activeLastOpenThreadAtom: LastOpenThreadAtom | undefined;
const lastOpenThreadAtoms = new Map<string, LastOpenThreadAtom>();

export const makeLastOpenThreadAtom = (userId: string): LastOpenThreadAtom => {
  const existingAtom = lastOpenThreadAtoms.get(userId);
  if (existingAtom) return existingAtom;

  const storeKey = getStoreKey(userId);

  const baseLastOpenThreadAtom = atomWithLocalStorage<Map<string, string>>(
    storeKey,
    (key) => new Map(Object.entries(getLocalStorageItem<Record<string, string>>(key, {}))),
    (key, value) => setLocalStorageItem(key, Object.fromEntries(value))
  );

  const lastOpenThreadAtom = atom<Map<string, string>, [LastOpenThreadAction], undefined>(
    (get) => get(baseLastOpenThreadAtom),
    (get, set, action) => {
      const current = get(baseLastOpenThreadAtom);

      if (action.type === 'DELETE') {
        if (!current.has(action.roomId)) return;
        const next = new Map(current);
        next.delete(action.roomId);
        set(baseLastOpenThreadAtom, next);
        return;
      }

      if (current.get(action.roomId) === action.threadId) return;

      const next = new Map(current);
      next.set(action.roomId, action.threadId);
      set(baseLastOpenThreadAtom, next);
    }
  );

  lastOpenThreadAtoms.set(userId, lastOpenThreadAtom);
  return lastOpenThreadAtom;
};

export const registerLastOpenThreadAtom = (lastOpenThreadAtom: LastOpenThreadAtom) => {
  activeLastOpenThreadAtom = lastOpenThreadAtom;

  return () => {
    if (activeLastOpenThreadAtom === lastOpenThreadAtom) {
      activeLastOpenThreadAtom = undefined;
    }
  };
};

const getResolvedLastOpenThreadAtom = (): LastOpenThreadAtom | undefined => {
  if (activeLastOpenThreadAtom) return activeLastOpenThreadAtom;

  const userId = getActiveSession()?.userId;
  return userId ? makeLastOpenThreadAtom(userId) : undefined;
};

export const getLastOpenThread = (roomId: string): string | undefined => {
  const lastOpenThreadAtom = getResolvedLastOpenThreadAtom();
  return lastOpenThreadAtom
    ? getImperativeJotaiStore().get(lastOpenThreadAtom).get(roomId)
    : undefined;
};

export const setLastOpenThread = (roomId: string, threadId: string) => {
  const lastOpenThreadAtom = getResolvedLastOpenThreadAtom();
  if (!lastOpenThreadAtom) return;

  getImperativeJotaiStore().set(lastOpenThreadAtom, { type: 'PUT', roomId, threadId });
};

export const clearLastOpenThread = (roomId: string) => {
  const lastOpenThreadAtom = getResolvedLastOpenThreadAtom();
  if (!lastOpenThreadAtom) return;

  getImperativeJotaiStore().set(lastOpenThreadAtom, { type: 'DELETE', roomId });
};

export const clearLastOpenThreadStore = (userId: string) => {
  const lastOpenThreadAtom = lastOpenThreadAtoms.get(userId);
  if (activeLastOpenThreadAtom === lastOpenThreadAtom) {
    activeLastOpenThreadAtom = undefined;
  }
  lastOpenThreadAtoms.delete(userId);
  localStorage.removeItem(getStoreKey(userId));
};
