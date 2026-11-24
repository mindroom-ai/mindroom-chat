import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DictationSegmentMeta } from '../dictation/dictationRefinement';
import { getAudioFileExtension } from '../voice/voiceRecorderMime';

/**
 * Tail PCM chunks share the `'chunks'` store with emitted segment WAVs (`0 .. TAIL_SEQ_OFFSET - 1`)
 * under keys `[id, TAIL_SEQ_OFFSET + tailSeq]` so both live inside the v1 `'mindroom-voice-journal'`
 * database without a schema migration.
 */
export const TAIL_SEQ_OFFSET = 1_000_000;

const DICTATION_TAIL_MIME = 'audio/pcm;encoding=s16le;rate=16000';

export type PersistedDictationSegment = DictationSegmentMeta & {
  status: 'queued' | 'completed' | 'failed';
  text?: string;
  error?: string;
  retryable: boolean;
};

export type PersistedRefinementGroup = {
  startIndex: number;
  endIndex: number;
  state: 'open' | 'queued' | 'refined' | 'fallback';
  refinedText?: string;
  refinedEndIndex?: number;
};

export type DictationJournalMeta = {
  startedAt: number;
  elapsedMs: number;
  capReached: boolean;
  consumedThroughFramePos?: number;
  originApiUrl?: string;
  originRoomId?: string;
  segments: PersistedDictationSegment[];
  groups: PersistedRefinementGroup[];
};

/**
 * In-progress 16 kHz Int16 PCM frames buffered before VAD cuts them into a segment WAV.
 * Frame positions use a half-open range `[startFramePos, endFramePos)`.
 */
export type DictationTailChunk = {
  seq: number;
  bytes: ArrayBuffer;
  elapsedMs: number;
  startFramePos: number;
  endFramePos: number;
};

export type DictationJournalHandle = {
  readonly id: string;
  appendTail: (
    seq: number,
    pcm16: ArrayBuffer,
    elapsedMs: number,
    startFramePos: number,
    endFramePos: number
  ) => Promise<void>;
  commitSegment: (
    segmentIndex: number,
    wav: ArrayBuffer,
    meta: DictationJournalMeta
  ) => Promise<void>;
  updateState: (
    meta: DictationJournalMeta,
    pruneSegmentIndices?: readonly number[],
    clearAllTail?: boolean
  ) => Promise<void>;
  remove: () => Promise<void>;
  release: () => void;
};

export type RecoveredDictationJournal = {
  id: string;
  meta: DictationJournalMeta;
  wavs: Map<number, ArrayBuffer>;
  tailChunks: DictationTailChunk[];
  journal: DictationJournalHandle;
};

type VoiceRecordingRow = {
  id: string;
  kind?: 'voice';
  userId: string;
  startedAt: number;
  mimeType: string;
};

type DictationRecordingRow = DictationJournalMeta & {
  id: string;
  kind: 'dictation';
  /** Stores sessionId (`createSessionId(baseUrl, userId)`) in the existing v1 `'userId'` index. */
  userId: string;
};

type RecordingRow = VoiceRecordingRow | DictationRecordingRow;

type VoiceOrWavChunkRow = {
  id: string;
  seq: number;
  bytes: ArrayBuffer;
  type: string;
  elapsedMs: number;
};

type DictationTailChunkRow = {
  id: string;
  seq: number;
  bytes: ArrayBuffer;
  type: typeof DICTATION_TAIL_MIME;
  elapsedMs: number;
  startFramePos: number;
  endFramePos: number;
};

type ChunkRow = VoiceOrWavChunkRow | DictationTailChunkRow;

interface JournalDb extends DBSchema {
  recordings: { key: string; value: RecordingRow; indexes: { userId: string } };
  chunks: { key: [string, number]; value: ChunkRow };
}

const isVoiceRow = (row: RecordingRow): row is VoiceRecordingRow =>
  row.kind === undefined || row.kind === 'voice';

const isDictationRow = (row: RecordingRow): row is DictationRecordingRow =>
  row.kind === 'dictation';

const isDictationTailChunkRow = (row: ChunkRow): row is DictationTailChunkRow =>
  row.seq >= TAIL_SEQ_OFFSET && 'startFramePos' in row && 'endFramePos' in row;

const cloneDictationMeta = (meta: DictationJournalMeta): DictationJournalMeta => ({
  ...meta,
  segments: meta.segments.map((segment) => ({ ...segment })),
  groups: meta.groups.map((group) => ({ ...group })),
});

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
/** The writes still queued for a capture this tab is making. */
const tails = new Map<string, () => Promise<unknown>>();
const starts = new Map<string, Promise<boolean>>();

export const holdCapture = (id: string): Promise<boolean> =>
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

/** Gives the capture's lock up, once the writes queued for it are on disk. */
export const releaseCapture = (id: string): void => {
  void Promise.resolve(tails.get(id)?.()).then(() => unlock(id));
};

const chunksOf = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity]);
const tailChunksOf = (id: string) => IDBKeyRange.bound([id, TAIL_SEQ_OFFSET], [id, Infinity]);

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

/** Runs a transaction only if the recording row still exists (sign-out in another tab may delete it). */
const guardedWrite = (id: string, work: (tx: WriteTx) => Promise<unknown>) =>
  withDb((db) =>
    change(db, async (tx) => {
      if (await tx.objectStore('recordings').getKey(id)) await work(tx);
    })
  );

type WriteEnqueue = (work: () => Promise<void>) => Promise<void>;

const createWriteQueue = (id: string, ready: Promise<boolean>): WriteEnqueue => {
  let tail: Promise<unknown> = ready;
  tails.set(id, () => tail);
  return (work) => {
    const next = tail.then(async () => {
      if (!(await ready) || !held.has(id)) return;
      await work();
    });
    tail = next;
    return next;
  };
};

const openLockedRecord = (row: RecordingRow): WriteEnqueue => {
  const { id } = row;
  const start = holdCapture(id).then(async (locked) => {
    if (!locked) return false;
    const stored = await withDb((db) => db.add('recordings', row));
    if (!stored) unlock(id);
    return !!stored;
  });
  starts.set(id, start);
  void start.then(() => starts.delete(id));
  return createWriteQueue(id, start);
};

const recoverLockedRecords = async <R extends RecordingRow>(
  ownerKey: string,
  filter: (row: RecordingRow) => row is R,
  offer: (row: R, chunks: ChunkRow[]) => boolean | Promise<boolean>,
  skipId?: string
): Promise<void> => {
  if (!globalThis.navigator?.locks) return;
  await withDb(async (db) => {
    const records = (await db.getAllFromIndex('recordings', 'userId', ownerKey)).filter(filter);
    records.sort((a, b) => a.startedAt - b.startedAt);
    /* eslint-disable no-await-in-loop, no-continue */
    for (const row of records) {
      if (row.id === skipId || !(await holdCapture(row.id))) continue;
      let accepted = false;
      try {
        const chunks = await db.getAll('chunks', chunksOf(row.id));
        accepted = await offer(row, chunks);
        if (accepted) return;
      } finally {
        if (!accepted) unlock(row.id);
      }
    }
    /* eslint-enable no-await-in-loop, no-continue */
  });
};

export const deleteCapture = async (id?: string): Promise<void> => {
  if (!id) return;
  await starts.get(id);
  const deleted = await withDb((db) => change(db, (tx) => deleteRows(tx, id)));
  if (deleted) unlock(id);
};

export const beginVoiceRecording = (userId: string, startedAt: number, mimeType: string) => {
  if (!globalThis.navigator?.locks) return undefined;
  const id = crypto.randomUUID();
  const enqueue = openLockedRecord({ id, kind: 'voice', userId, startedAt, mimeType });
  return {
    id,
    remove: () => deleteCapture(id),
    release: () => releaseCapture(id),
    append: (seq: number, data: Blob, elapsedMs: number) => {
      const bytes = data.arrayBuffer().catch(() => undefined);
      return enqueue(async () => {
        const buffer = await bytes;
        if (!buffer) return;
        await guardedWrite(id, (tx) =>
          tx.objectStore('chunks').put({ id, seq, bytes: buffer, elapsedMs, type: data.type })
        );
      });
    },
  };
};

type RecoveredVoice = { recordingId: string; file: File; duration: number };

export const recoverVoiceRecording = (
  userId: string,
  skipId: string | undefined,
  offer: (recording: RecoveredVoice) => boolean | Promise<boolean>
): Promise<void> =>
  recoverLockedRecords(
    userId,
    isVoiceRow,
    async ({ id, startedAt, mimeType }, chunks) => {
      const last = chunks.at(-1);
      if (!last) {
        await deleteCapture(id);
        return false;
      }
      const type = chunks[0]?.type || mimeType;
      return offer({
        recordingId: id,
        file: new File(
          chunks.map((c) => c.bytes),
          `voice-message-${startedAt}.${getAudioFileExtension(type)}`,
          { type }
        ),
        duration: Math.max(1, Math.round(last.elapsedMs)),
      });
    },
    skipId
  );

const createDictationJournalHandle = (
  id: string,
  sessionId: string,
  enqueue: WriteEnqueue
): DictationJournalHandle => ({
  id,
  remove: () => deleteCapture(id),
  release: () => releaseCapture(id),
  appendTail: (seq, pcm16, elapsedMs, startFramePos, endFramePos) =>
    enqueue(async () => {
      await guardedWrite(id, (tx) =>
        tx.objectStore('chunks').put({
          id,
          seq: TAIL_SEQ_OFFSET + seq,
          bytes: pcm16,
          type: DICTATION_TAIL_MIME,
          elapsedMs,
          startFramePos,
          endFramePos,
        })
      );
    }),
  commitSegment: (segmentIndex, wav, meta) => {
    const snapshot = cloneDictationMeta(meta);
    return enqueue(async () => {
      await guardedWrite(id, async (tx) => {
        const chunksStore = tx.objectStore('chunks');
        const ops: Promise<unknown>[] = [
          chunksStore.put({
            id,
            seq: segmentIndex,
            bytes: wav,
            type: 'audio/wav',
            elapsedMs: snapshot.elapsedMs,
          }),
          tx.objectStore('recordings').put({
            id,
            kind: 'dictation',
            userId: sessionId,
            ...snapshot,
          }),
        ];
        if (snapshot.consumedThroughFramePos !== undefined) {
          const cutoff = snapshot.consumedThroughFramePos;
          const tailRows = await chunksStore.getAll(tailChunksOf(id));
          for (const row of tailRows) {
            if (isDictationTailChunkRow(row) && row.endFramePos <= cutoff) {
              ops.push(chunksStore.delete([id, row.seq]));
            }
          }
        }
        await Promise.all(ops);
      });
    });
  },
  updateState: (meta, pruneSegmentIndices, clearAllTail) => {
    const snapshot = cloneDictationMeta(meta);
    if (clearAllTail) delete snapshot.consumedThroughFramePos;
    const prune = pruneSegmentIndices ? [...pruneSegmentIndices] : undefined;
    return enqueue(async () => {
      await guardedWrite(id, async (tx) => {
        const chunksStore = tx.objectStore('chunks');
        const ops: Promise<unknown>[] = [
          tx.objectStore('recordings').put({
            id,
            kind: 'dictation',
            userId: sessionId,
            ...snapshot,
          }),
        ];
        if (prune && prune.length > 0) {
          prune.forEach((segIdx) => ops.push(chunksStore.delete([id, segIdx])));
        }
        if (clearAllTail) ops.push(chunksStore.delete(tailChunksOf(id)));
        await Promise.all(ops);
      });
    });
  },
});

export const beginDictationJournal = (
  sessionId: string,
  meta: DictationJournalMeta
): DictationJournalHandle | undefined => {
  if (!globalThis.navigator?.locks) return undefined;
  const id = crypto.randomUUID();
  const enqueue = openLockedRecord({
    id,
    kind: 'dictation',
    userId: sessionId,
    ...cloneDictationMeta(meta),
  });
  return createDictationJournalHandle(id, sessionId, enqueue);
};

export const recoverDictationJournal = (
  sessionId: string,
  offer: (recovered: RecoveredDictationJournal) => boolean | Promise<boolean>
): Promise<void> =>
  recoverLockedRecords(sessionId, isDictationRow, (row, chunks) => {
    const { id, kind: _kind, userId: _userId, ...meta } = row;
    const wavs = new Map<number, ArrayBuffer>();
    const tailChunks: DictationTailChunk[] = [];
    for (const chunk of chunks) {
      if (chunk.seq < TAIL_SEQ_OFFSET) wavs.set(chunk.seq, chunk.bytes);
      else if (isDictationTailChunkRow(chunk)) {
        tailChunks.push({
          seq: chunk.seq - TAIL_SEQ_OFFSET,
          bytes: chunk.bytes,
          elapsedMs: chunk.elapsedMs,
          startFramePos: chunk.startFramePos,
          endFramePos: chunk.endFramePos,
        });
      }
    }
    const journal = createDictationJournalHandle(
      id,
      sessionId,
      createWriteQueue(id, Promise.resolve(true))
    );
    return offer({ id, meta, wavs, tailChunks, journal });
  });

/** Cheap read-only check for whether the session has any dictation record on disk (no locks). */
export const hasDictationJournalRecord = async (sessionId: string): Promise<boolean> => {
  if (!globalThis.navigator?.locks) return false;
  const found = await withDb(async (db) => {
    const records = await db.getAllFromIndex('recordings', 'userId', sessionId);
    return records.some(isDictationRow);
  });
  return found === true;
};

/** Removes all persisted journal rows indexed under `ownerKey` (`userId` for voice, `sessionId` for dictation). */
export const clearCaptureJournal = async (ownerKey: string): Promise<void> => {
  await Promise.all(starts.values());
  const deleted = await withDb((db) =>
    change(db, async (tx) => {
      const ids = await tx.objectStore('recordings').index('userId').getAllKeys(ownerKey);
      await Promise.all(ids.map((id) => deleteRows(tx, id)));
      return ids;
    })
  );
  deleted?.forEach(unlock);
};
