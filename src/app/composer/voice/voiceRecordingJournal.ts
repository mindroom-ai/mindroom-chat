import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  cancelNativeVoiceRecording,
  listNativeVoiceLeftovers,
  readNativeVoiceFile,
} from '../../native/nativeVoiceRecorder';
import { getAudioFileExtension } from './voiceRecorderMime';

type Recording = { id: string; userId: string; startedAt: number; mimeType: string };
type Chunk = { id: string; seq: number; bytes: ArrayBuffer; type: string; elapsedMs: number };
interface JournalDb extends DBSchema {
  recordings: { key: string; value: Recording; indexes: { userId: string } };
  chunks: { key: [string, number]; value: Chunk };
}

const withDb = async <T>(work: (db: IDBPDatabase<JournalDb>) => Promise<T>) => {
  try {
    const db = await openDB<JournalDb>('mindroom-voice-journal', 1, {
      upgrade(db) {
        db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('userId', 'userId');
        db.createObjectStore('chunks', { keyPath: ['id', 'seq'] });
      },
    });
    try {
      return await work(db);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
};

const held = new Map<string, () => void>();
export const holdVoiceRecording = (id: string): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const locks = globalThis.navigator?.locks;
    if (!locks) return resolve(false);
    locks
      .request(`mindroom-voice-recording:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        return new Promise<void>((release) => {
          held.set(id, release);
          resolve(true);
        });
      })
      .catch(() => resolve(false));
  }).catch(() => false);

export const releaseVoiceRecording = (id: string): void => {
  held.get(id)?.();
  held.delete(id);
};

const chunksOf = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity]);
const write = (db: IDBPDatabase<JournalDb>) =>
  db.transaction(['recordings', 'chunks'], 'readwrite', { durability: 'strict' });
type WriteTx = ReturnType<typeof write>;
const change = <T>(db: IDBPDatabase<JournalDb>, work: (tx: WriteTx) => Promise<T>) => {
  const tx = write(db);
  return Promise.all([work(tx), tx.done]).then(([result]) => result);
};
const deleteRows = (tx: WriteTx, id: string) =>
  Promise.all([
    tx.objectStore('recordings').delete(id),
    tx.objectStore('chunks').delete(chunksOf(id)),
  ]);
const starts = new Map<string, Promise<boolean>>();

export const deleteVoiceRecording = async (id?: string): Promise<void> => {
  if (!id) return;
  await starts.get(id);
  const deleted = await withDb((db) => change(db, (tx) => deleteRows(tx, id)));
  if (deleted) releaseVoiceRecording(id);
};

export const beginVoiceRecording = (
  userId: string,
  startedAt: number,
  mimeType: string,
  nativeId?: string
) => {
  if (!globalThis.navigator?.locks) return undefined;
  const id = nativeId ?? crypto.randomUUID();
  const start = holdVoiceRecording(id).then(async (locked) => {
    if (!locked) return false;
    const stored = await withDb(async (db) => {
      if (nativeId && (await db.getKey('recordings', id))) return id;
      return db.add('recordings', { id, userId, startedAt, mimeType });
    });
    if (!stored) releaseVoiceRecording(id);
    return !!stored;
  });
  starts.set(id, start);
  void start.then(() => starts.delete(id));
  let tail = start;
  return {
    id,
    ready: start,
    remove: async () => {
      if (nativeId && !(await start)) return;
      // A successful native append must survive a failed or interrupted handoff.
      if (nativeId && tail !== start && (await tail)) releaseVoiceRecording(id);
      else await deleteVoiceRecording(id);
    },
    release: () => {
      void tail.then(async () => {
        if (await start) releaseVoiceRecording(id);
      });
    },
    append: async (seq: number, data: Blob, elapsedMs: number) => {
      const bytes = data.arrayBuffer().catch(() => undefined);
      const next = tail.then(async () => {
        if (!(await start) || !held.has(id)) return false;
        const buffer = await bytes;
        if (!buffer) return false;
        const chunk = { id, seq, bytes: buffer, elapsedMs, type: nativeId ? mimeType : data.type };
        const committed = await withDb((db) =>
          change(db, async (tx) => {
            // Sign-out can delete the meta in another tab. Do not recreate its chunks.
            if (!(await tx.objectStore('recordings').getKey(id))) return false;
            const chunks = tx.objectStore('chunks');
            if (!nativeId || !(await chunks.getKey([id, seq]))) await chunks.put(chunk);
            return true;
          })
        );
        return committed === true;
      });
      tail = next;
      return next;
    },
  };
};

const nativeDeleted = (id: string) =>
  cancelNativeVoiceRecording(id)
    .then(() => true)
    .catch(() => false);

/** Transfers leftovers; a durable draft can verify unlisted UUIDs with idempotent cancel. */
export const importNativeVoiceRecordings = async (userId: string) => {
  if (!globalThis.navigator?.locks) return undefined;
  const { recordings } = await listNativeVoiceLeftovers().catch(() => ({ recordings: [] }));
  const transferred = new Map<string, boolean>();
  /* eslint-disable no-await-in-loop, no-continue */
  for (const { id, startedAt, duration, userId: owner } of recordings) {
    if (owner !== userId) continue;
    transferred.set(id, false);
    const journal = beginVoiceRecording(userId, startedAt, 'audio/mp4', id);
    if (!journal || !(await journal.ready)) continue;
    try {
      // The first list may predate a send or discard in another window.
      const current = await listNativeVoiceLeftovers();
      const file = current.recordings.find((item) => item.id === id && item.userId === userId);
      if (file) {
        const data = await readNativeVoiceFile(file.path);
        if (!data || !(await journal.append(0, data, duration))) continue;
      }
      transferred.set(id, !file || (await nativeDeleted(id)));
    } catch {
      // A failed handoff stays off this page.
    } finally {
      journal.release();
    }
  }
  /* eslint-enable no-await-in-loop, no-continue */
  return (id: string) => transferred.get(id) ?? nativeDeleted(id);
};

type Recovered = { recordingId: string; file: File; duration: number };
export const recoverVoiceRecording = async (
  userId: string,
  skipId: string | undefined,
  offer: (recording: Recovered) => boolean | Promise<boolean>
): Promise<void> => {
  if (!globalThis.navigator?.locks) return;
  await withDb(async (db) => {
    const records = await db.getAllFromIndex('recordings', 'userId', userId);
    records.sort((a, b) => a.startedAt - b.startedAt);
    /* eslint-disable no-await-in-loop, no-continue */
    for (const { id, startedAt, mimeType } of records) {
      if (id === skipId || !(await holdVoiceRecording(id))) continue;
      let accepted = false;
      try {
        const chunks = await db.getAll('chunks', chunksOf(id));
        const last = chunks.at(-1);
        if (!last) {
          await deleteVoiceRecording(id);
          continue;
        }
        const type = chunks[0]?.type || mimeType;
        accepted = await offer({
          recordingId: id,
          file: new File(
            chunks.map((c) => c.bytes),
            `voice-message-${startedAt}.${getAudioFileExtension(type)}`,
            { type }
          ),
          duration: Math.max(1, Math.round(last.elapsedMs)),
        });
        if (accepted) return;
      } finally {
        if (!accepted) releaseVoiceRecording(id);
      }
    }
    /* eslint-enable no-await-in-loop, no-continue */
  });
};

export const clearVoiceRecordings = async (userId: string): Promise<void> => {
  await Promise.all(starts.values());
  const deleted = await withDb((db) =>
    change(db, async (tx) => {
      const ids = await tx.objectStore('recordings').index('userId').getAllKeys(userId);
      await Promise.all(ids.map((id) => deleteRows(tx, id)));
      return ids;
    })
  );
  deleted?.forEach(releaseVoiceRecording);
};
