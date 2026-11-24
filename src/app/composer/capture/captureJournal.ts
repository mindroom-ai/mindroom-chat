import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DictationSegmentCutReason } from '../dictation/dictationSegmenter';
import { getAudioFileExtension } from '../voice/voiceRecorderMime';

/**
 * Tail PCM chunks share the `'chunks'` store with emitted segment WAVs (`0 .. TAIL_SEQ_OFFSET - 1`)
 * under keys `[id, TAIL_SEQ_OFFSET + tailSeq]` so both live inside the v1 `'mindroom-voice-journal'`
 * database without a schema migration.
 */
export const TAIL_SEQ_OFFSET = 1_000_000;

const DICTATION_TAIL_MIME = 'audio/pcm;encoding=s16le;rate=16000';

export type PersistedDictationSegment = {
  index: number;
  seconds: number;
  overlapped: boolean;
  cutReason: DictationSegmentCutReason;
  leadingQuietFrames: number;
  trailingQuietFrames: number;
  pauseBeforeMs: number;
  status: 'queued' | 'completed' | 'failed';
  text?: string;
  error?: string;
  retryable: boolean;
  hasWav: boolean;
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
    meta: DictationJournalMeta,
    clearTailThroughFramePos?: number
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

export const holdVoiceRecording = holdCapture;

const unlock = (id: string): void => {
  held.get(id)?.();
  held.delete(id);
  tails.delete(id);
};

/** Gives the capture's lock up, once the writes queued for it are on disk. */
export const releaseCapture = (id: string): void => {
  void Promise.resolve(tails.get(id)?.()).then(() => unlock(id));
};

export const releaseVoiceRecording = releaseCapture;

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

export const deleteCapture = async (id?: string): Promise<void> => {
  if (!id) return;
  await starts.get(id);
  const deleted = await withDb((db) => change(db, (tx) => deleteRows(tx, id)));
  if (deleted) unlock(id);
};

export const deleteVoiceRecording = deleteCapture;

export const beginVoiceRecording = (userId: string, startedAt: number, mimeType: string) => {
  if (!globalThis.navigator?.locks) return undefined;
  const id = crypto.randomUUID();
  const start = holdCapture(id).then(async (locked) => {
    if (!locked) return false;
    const stored = await withDb((db) =>
      db.add('recordings', { id, kind: 'voice', userId, startedAt, mimeType })
    );
    if (!stored) unlock(id);
    return !!stored;
  });
  starts.set(id, start);
  void start.then(() => starts.delete(id));
  let tail: Promise<unknown> = start;
  tails.set(id, () => tail);
  return {
    id,
    remove: () => deleteCapture(id),
    release: () => releaseCapture(id),
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

type RecoveredVoice = { recordingId: string; file: File; duration: number };

export const recoverVoiceRecording = async (
  userId: string,
  skipId: string | undefined,
  offer: (recording: RecoveredVoice) => boolean | Promise<boolean>
): Promise<void> => {
  if (!globalThis.navigator?.locks) return;
  await withDb(async (db) => {
    const records = (await db.getAllFromIndex('recordings', 'userId', userId)).filter(isVoiceRow);
    records.sort((a, b) => a.startedAt - b.startedAt);
    /* eslint-disable no-await-in-loop, no-continue */
    for (const { id, startedAt, mimeType } of records) {
      if (id === skipId || !(await holdCapture(id))) continue;
      let accepted = false;
      try {
        const chunks = await db.getAll('chunks', chunksOf(id));
        const last = chunks.at(-1);
        if (!last) {
          await deleteCapture(id);
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
        if (!accepted) unlock(id);
      }
    }
    /* eslint-enable no-await-in-loop, no-continue */
  });
};

const createDictationJournalHandle = (
  id: string,
  userId: string,
  ready: Promise<boolean>
): DictationJournalHandle => {
  let tail: Promise<unknown> = ready;
  tails.set(id, () => tail);

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const next = tail.then(async () => {
      if (!(await ready) || !held.has(id)) return;
      await work();
    });
    tail = next;
    return next;
  };

  return {
    id,
    remove: () => deleteCapture(id),
    release: () => releaseCapture(id),
    appendTail: (seq, pcm16, elapsedMs, startFramePos, endFramePos) =>
      enqueue(async () => {
        await withDb((db) =>
          change(db, async (tx) => {
            if (await tx.objectStore('recordings').getKey(id)) {
              await tx.objectStore('chunks').put({
                id,
                seq: TAIL_SEQ_OFFSET + seq,
                bytes: pcm16,
                type: DICTATION_TAIL_MIME,
                elapsedMs,
                startFramePos,
                endFramePos,
              });
            }
          })
        );
      }),
    commitSegment: (segmentIndex, wav, meta, clearTailThroughFramePos) => {
      const snapshot = cloneDictationMeta(meta);
      return enqueue(async () => {
        await withDb((db) =>
          change(db, async (tx) => {
            if (!(await tx.objectStore('recordings').getKey(id))) return;
            const chunksStore = tx.objectStore('chunks');
            await chunksStore.put({
              id,
              seq: segmentIndex,
              bytes: wav,
              type: 'audio/wav',
              elapsedMs: snapshot.elapsedMs,
            });
            if (clearTailThroughFramePos !== undefined) {
              const tailRows = await chunksStore.getAll(tailChunksOf(id));
              const ops: Promise<unknown>[] = [];
              for (const row of tailRows) {
                if (isDictationTailChunkRow(row)) {
                  if (row.endFramePos <= clearTailThroughFramePos) {
                    ops.push(chunksStore.delete([id, row.seq]));
                  } else if (row.startFramePos < clearTailThroughFramePos) {
                    const totalFrames = row.endFramePos - row.startFramePos;
                    const dropFrames = clearTailThroughFramePos - row.startFramePos;
                    if (totalFrames > 0 && row.bytes.byteLength % totalFrames === 0) {
                      const bytesPerFrame = row.bytes.byteLength / totalFrames;
                      ops.push(
                        chunksStore.put({
                          ...row,
                          bytes: row.bytes.slice(dropFrames * bytesPerFrame),
                          startFramePos: clearTailThroughFramePos,
                        })
                      );
                    } else {
                      ops.push(chunksStore.delete([id, row.seq]));
                    }
                  }
                }
              }
              await Promise.all(ops);
            }
            await tx.objectStore('recordings').put({
              id,
              kind: 'dictation',
              userId,
              ...snapshot,
            });
          })
        );
      });
    },
    updateState: (meta, pruneSegmentIndices, clearAllTail) => {
      const snapshot = cloneDictationMeta(meta);
      const prune = pruneSegmentIndices ? [...pruneSegmentIndices] : undefined;
      return enqueue(async () => {
        await withDb((db) =>
          change(db, async (tx) => {
            if (!(await tx.objectStore('recordings').getKey(id))) return;
            const chunksStore = tx.objectStore('chunks');
            const ops: Promise<unknown>[] = [
              tx.objectStore('recordings').put({
                id,
                kind: 'dictation',
                userId,
                ...snapshot,
              }),
            ];
            if (prune && prune.length > 0) {
              prune.forEach((segIdx) => ops.push(chunksStore.delete([id, segIdx])));
            }
            if (clearAllTail) {
              ops.push(chunksStore.delete(tailChunksOf(id)));
            }
            await Promise.all(ops);
          })
        );
      });
    },
  };
};

export const beginDictationJournal = (
  userId: string,
  meta: DictationJournalMeta
): DictationJournalHandle | undefined => {
  if (!globalThis.navigator?.locks) return undefined;
  const id = crypto.randomUUID();
  const initial = cloneDictationMeta(meta);
  const start = holdCapture(id).then(async (locked) => {
    if (!locked) return false;
    const stored = await withDb((db) =>
      db.add('recordings', { id, kind: 'dictation', userId, ...initial })
    );
    if (!stored) unlock(id);
    return !!stored;
  });
  starts.set(id, start);
  void start.then(() => starts.delete(id));
  return createDictationJournalHandle(id, userId, start);
};

export const recoverDictationJournal = async (
  userId: string,
  offer: (recovered: RecoveredDictationJournal) => boolean | Promise<boolean>
): Promise<void> => {
  if (!globalThis.navigator?.locks) return;
  await withDb(async (db) => {
    const records = (await db.getAllFromIndex('recordings', 'userId', userId)).filter(
      isDictationRow
    );
    records.sort((a, b) => a.startedAt - b.startedAt);
    /* eslint-disable no-await-in-loop, no-continue */
    for (const row of records) {
      const { id } = row;
      if (!(await holdCapture(id))) continue;
      let accepted = false;
      try {
        const chunks = await db.getAll('chunks', chunksOf(id));
        const wavs = new Map<number, ArrayBuffer>();
        const tailChunks: DictationTailChunk[] = [];
        for (const chunk of chunks) {
          if (chunk.seq < TAIL_SEQ_OFFSET) {
            wavs.set(chunk.seq, chunk.bytes);
          } else if (isDictationTailChunkRow(chunk)) {
            tailChunks.push({
              seq: chunk.seq - TAIL_SEQ_OFFSET,
              bytes: chunk.bytes,
              elapsedMs: chunk.elapsedMs,
              startFramePos: chunk.startFramePos,
              endFramePos: chunk.endFramePos,
            });
          }
        }
        const { id: _id, kind: _kind, userId: _userId, ...meta } = row;
        const journal = createDictationJournalHandle(id, userId, Promise.resolve(true));
        accepted = await offer({ id, meta, wavs, tailChunks, journal });
        if (accepted) return;
      } finally {
        if (!accepted) unlock(id);
      }
    }
    /* eslint-enable no-await-in-loop, no-continue */
  });
};

/** Cheap read-only check for whether the account has any dictation record on disk (no locks). */
export const hasDictationJournalRecord = async (userId: string): Promise<boolean> => {
  if (!globalThis.navigator?.locks) return false;
  const found = await withDb(async (db) => {
    const records = await db.getAllFromIndex('recordings', 'userId', userId);
    return records.some(isDictationRow);
  });
  return found === true;
};

/** Removes all persisted voice and dictation journal rows for `userId` (sign-out). */
export const clearCaptureJournal = async (userId: string): Promise<void> => {
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
