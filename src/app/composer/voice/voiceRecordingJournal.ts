import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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
/** The writes still queued for a recording this tab is making. */
const tails = new Map<string, () => Promise<unknown>>();
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

const unlock = (id: string): void => {
  held.get(id)?.();
  held.delete(id);
  tails.delete(id);
};
/** Gives the recording's lock up, once the writes queued for it are on disk. */
export const releaseVoiceRecording = (id: string): void => {
  void Promise.resolve(tails.get(id)?.()).then(() => unlock(id));
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
  if (deleted) unlock(id);
};

export const beginVoiceRecording = (userId: string, startedAt: number, mimeType: string) => {
  if (!globalThis.navigator?.locks) return undefined;
  const id = crypto.randomUUID();
  const start = holdVoiceRecording(id).then(async (locked) => {
    if (!locked) return false;
    const stored = await withDb((db) => db.add('recordings', { id, userId, startedAt, mimeType }));
    if (!stored) unlock(id);
    return !!stored;
  });
  starts.set(id, start);
  void start.then(() => starts.delete(id));
  let tail: Promise<unknown> = start;
  tails.set(id, () => tail);
  return {
    id,
    remove: () => deleteVoiceRecording(id),
    release: () => releaseVoiceRecording(id),
    append: async (seq: number, data: Blob, elapsedMs: number) => {
      const bytes = data.arrayBuffer().catch(() => undefined);
      const next = tail.then(async () => {
        if (!(await start) || !held.has(id)) return;
        const buffer = await bytes;
        if (!buffer) return;
        await withDb((db) =>
          change(db, async (tx) => {
            // Sign-out can delete the meta in another tab. Do not recreate its chunks.
            if (await tx.objectStore('recordings').getKey(id)) {
              await tx
                .objectStore('chunks')
                .put({ id, seq, bytes: buffer, elapsedMs, type: data.type });
            }
          })
        );
      });
      tail = next;
      return next;
    },
  };
};

type Recovered = { recordingId: string; file: File; duration: number };
export const recoverVoiceRecording = async (
  userId: string,
  skipId: string | undefined,
  offer: (recording: Recovered) => boolean
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
        accepted = offer({
          recordingId: id,
          file: new File(
            chunks.map((c) => c.bytes),
            `voice-message-${startedAt}.${getAudioFileExtension(type)}`,
            { type }
          ),
          duration: Math.max(1, Math.round(last.elapsedMs)),
        });
        return;
      } finally {
        if (!accepted) unlock(id);
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
  deleted?.forEach(unlock);
};
