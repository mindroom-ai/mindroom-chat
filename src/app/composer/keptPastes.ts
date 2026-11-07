import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * The text of large pastes, the "Pasted text" chips that send as a file, kept per account in
 * IndexedDB so that a draft kept across a reload or an app update keeps them too. The draft
 * itself lives in localStorage, whose few megabytes every draft shares, so the text stays out of
 * it. A paste the browser refuses to store (private window, full disk, quota) is not kept: the
 * restored draft then drops its chip with a notice. Sign-out forgets them, as it does the drafts.
 */
type KeptPaste = {
  userId: string;
  /** The paste's file name, unique per paste (`mindroom-paste-<id>.txt`). */
  fileName: string;
  /** The draft it was pasted into (`getRoomInputDraftKey`). */
  draftKey: string;
  text: string;
};

interface PasteDraftDb extends DBSchema {
  pastes: {
    key: [string, string];
    value: KeptPaste;
    indexes: { draft: [string, string] };
  };
}

const openPasteDb = (): Promise<IDBPDatabase<PasteDraftDb>> =>
  openDB<PasteDraftDb>('mindroom-paste-drafts', 1, {
    upgrade(db) {
      const store = db.createObjectStore('pastes', { keyPath: ['userId', 'fileName'] });
      store.createIndex('draft', ['userId', 'draftKey']);
    },
  });

const withPasteDb = async <T>(
  use: (db: IDBPDatabase<PasteDraftDb>) => Promise<T>
): Promise<T | undefined> => {
  try {
    const db = await openPasteDb();
    try {
      return await use(db);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
};

/** Keeps the text of a paste in `draftKey`. */
export const keepPasteText = async (
  userId: string,
  draftKey: string,
  fileName: string,
  text: string
): Promise<void> => {
  await withPasteDb((db) => db.put('pastes', { userId, fileName, draftKey, text }));
};

/** The kept texts of the pastes `fileNames`, by file name; a paste that was not kept is absent. */
export const readKeptPasteTexts = async (
  userId: string,
  fileNames: readonly string[]
): Promise<Map<string, string>> => {
  const texts = new Map<string, string>();
  await withPasteDb(async (db) => {
    const kept = await Promise.all(
      fileNames.map((fileName) => db.get('pastes', [userId, fileName]))
    );
    kept.forEach((paste) => {
      if (paste) texts.set(paste.fileName, paste.text);
    });
  });
  return texts;
};

/** Forgets the pastes kept for `draftKey` that the draft no longer holds. */
export const forgetPastesOutsideDraft = async (
  userId: string,
  draftKey: string,
  held: ReadonlySet<string>
): Promise<void> => {
  await withPasteDb(async (db) => {
    const tx = db.transaction('pastes', 'readwrite');
    let cursor = await tx.store.index('draft').openCursor([userId, draftKey]);
    while (cursor) {
      if (!held.has(cursor.value.fileName)) await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  });
};

/** Forgets every paste the account kept. */
export const clearKeptPastes = async (userId: string): Promise<void> => {
  await withPasteDb(async (db) => {
    const tx = db.transaction('pastes', 'readwrite');
    // Arrays sort after strings, so this spans every key that starts with the account.
    let cursor = await tx.store.openCursor(IDBKeyRange.bound([userId], [userId, []]));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  });
};
