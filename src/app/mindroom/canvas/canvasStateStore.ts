import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Canvases whose saved state is kept per session; the ones saved longest ago are forgotten first. */
export const MAX_STORED_CANVAS_STATES = 100;

type StoredCanvasState = { canvasId: string; json: string; savedAt: number };

interface CanvasStateDb extends DBSchema {
  states: { key: string; value: StoredCanvasState; indexes: { savedAt: number } };
}

/** One database per session, deleted with the session's other data at logout (`sessionLifecycle.ts`). */
export const getCanvasStateDbName = (sessionId: string): string =>
  `mindroom-canvas-state::${sessionId}`;

const openStateDb = (sessionId: string): Promise<IDBPDatabase<CanvasStateDb>> =>
  openDB<CanvasStateDb>(getCanvasStateDbName(sessionId), 1, {
    upgrade(db) {
      db.createObjectStore('states', { keyPath: 'canvasId' }).createIndex('savedAt', 'savedAt');
    },
  });

/** The JSON a canvas page last saved in this session, if any. */
export const loadCanvasState = async (
  sessionId: string,
  canvasId: string
): Promise<string | undefined> => {
  const db = await openStateDb(sessionId);
  try {
    return (await db.get('states', canvasId))?.json;
  } finally {
    db.close();
  }
};

export const saveCanvasState = async (
  sessionId: string,
  canvasId: string,
  json: string
): Promise<void> => {
  const db = await openStateDb(sessionId);
  try {
    const tx = db.transaction('states', 'readwrite');
    // A failed request fails the transaction too; the caller hears of the request's failure only.
    tx.done.catch(() => undefined);
    const byAge = tx.store.index('savedAt');
    // Each save sorts after all others even if the clock went back, so the oldest is forgotten first.
    const newest = (await byAge.openCursor(null, 'prev'))?.value.savedAt ?? 0;
    await tx.store.put({ canvasId, json, savedAt: Math.max(Date.now(), newest + 1) });
    let extra = (await tx.store.count()) - MAX_STORED_CANVAS_STATES;
    let cursor = extra > 0 ? await byAge.openCursor() : null;
    while (cursor && extra > 0) {
      // eslint-disable-next-line no-await-in-loop
      await cursor.delete();
      extra -= 1;
      // eslint-disable-next-line no-await-in-loop
      cursor = await cursor.continue();
    }
    await tx.done;
  } finally {
    db.close();
  }
};
