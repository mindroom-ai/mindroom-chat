import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore } from 'idb';

/** Canvases listed per session; the ones updated longest ago are forgotten first. */
export const MAX_LISTED_CANVASES = 500;

/** A canvas made for this user, as the Canvases page lists it. */
export type CanvasListEntry = {
  canvasId: string;
  roomId: string;
  threadId?: string;
  agentUserId: string;
  title: string;
  createdTs: number;
  /** When the shown version was sent: the latest update, or the request itself. */
  updatedTs: number;
  shared: boolean;
};

interface CanvasIndexDb extends DBSchema {
  canvases: { key: string; value: CanvasListEntry; indexes: { updatedTs: number } };
}

type Store = IDBPObjectStore<CanvasIndexDb, ['canvases'], 'canvases', 'readwrite'>;

/** One database per session, deleted with the session's other data at logout (`sessionLifecycle.ts`). */
export const getCanvasIndexDbName = (sessionId: string): string =>
  `mindroom-canvas-index::${sessionId}`;

const openIndexDb = (sessionId: string): Promise<IDBPDatabase<CanvasIndexDb>> =>
  openDB<CanvasIndexDb>(getCanvasIndexDbName(sessionId), 1, {
    upgrade(db) {
      db.createObjectStore('canvases', { keyPath: 'canvasId' }).createIndex(
        'updatedTs',
        'updatedTs'
      );
    },
  });

const listeners = new Set<() => void>();

/** Calls the listener after each change to a session's list; returns the unsubscribe. */
export const subscribeCanvasList = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Runs one change and keeps the list within its bound; listeners hear of real changes only. */
const change = async (
  sessionId: string,
  apply: (store: Store) => Promise<boolean>
): Promise<void> => {
  const db = await openIndexDb(sessionId);
  try {
    const tx = db.transaction('canvases', 'readwrite');
    // A failed request fails the transaction too; the caller hears of the request's failure only.
    tx.done.catch(() => undefined);
    const changed = await apply(tx.store);
    let extra = (await tx.store.count()) - MAX_LISTED_CANVASES;
    let cursor = extra > 0 ? await tx.store.index('updatedTs').openCursor() : null;
    while (cursor && extra > 0) {
      // eslint-disable-next-line no-await-in-loop
      await cursor.delete();
      extra -= 1;
      // eslint-disable-next-line no-await-in-loop
      cursor = await cursor.continue();
    }
    await tx.done;
    if (changed) listeners.forEach((listener) => listener());
  } finally {
    db.close();
  }
};

/** Adds a canvas or refreshes it; an older copy of the request never rolls back a newer update. */
export const recordCanvas = (sessionId: string, entry: CanvasListEntry): Promise<void> =>
  change(sessionId, async (store) => {
    const known = await store.get(entry.canvasId);
    const next =
      known && known.updatedTs > entry.updatedTs
        ? { ...entry, title: known.title, updatedTs: known.updatedTs }
        : entry;
    if (known && JSON.stringify(known) === JSON.stringify(next)) return false;
    await store.put(next);
    return true;
  });

/** Applies an update of a listed canvas, when its agent sent it and it is the newest seen. */
export const recordCanvasUpdate = (
  sessionId: string,
  canvasId: string,
  sender: string,
  title: string,
  ts: number
): Promise<void> =>
  change(sessionId, async (store) => {
    const known = await store.get(canvasId);
    if (!known || known.agentUserId !== sender || ts < known.updatedTs) return false;
    if (known.title === title && known.updatedTs === ts) return false;
    await store.put({ ...known, title, updatedTs: ts });
    return true;
  });

export const forgetCanvas = (sessionId: string, canvasId: string): Promise<void> =>
  change(sessionId, async (store) => {
    if (!(await store.getKey(canvasId))) return false;
    await store.delete(canvasId);
    return true;
  });

export const listCanvases = async (sessionId: string): Promise<CanvasListEntry[]> => {
  const db = await openIndexDb(sessionId);
  try {
    return await db.getAll('canvases');
  } finally {
    db.close();
  }
};
