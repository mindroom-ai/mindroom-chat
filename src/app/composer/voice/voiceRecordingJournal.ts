import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { normalizeMatrixWaveform } from '../../lib/audioWaveform';
import { getVoiceFileName } from './voiceRecorderMime';

/**
 * Every voice recording on disk, from its first second until the server gave its voice event an
 * ID or the person let a Discard stand. The recorder appends each chunk as it arrives, so a crash,
 * a reload or an app update loses at most the last second; what sends it writes where it goes and
 * its Matrix transaction ID before anything is sent, so a retry after a crash posts it once.
 *
 * The tab that owns a recording holds the Web Lock named after it, from before its first write
 * until it deletes the record. A record nobody holds is an orphan, which the next page adopts.
 * A browser without Web Locks cannot tell whose a recording is, so there nothing is kept or
 * adopted: recordings live in memory and say so.
 */

/** Where a recording goes, as it is kept on disk: IDs only, none of the text it relates to. */
export type VoiceJournalDestination = {
  roomId: string;
  threadId?: string;
  /** The message it replies to, and the thread that message is in. */
  replyEventId?: string;
  replyThreadId?: string;
  threadingEnabled: boolean;
  threadView?: boolean;
};

export type VoiceJournalRecord = {
  userId: string;
  recordingId: string;
  startedAt: number;
  mimeType: string;
  /** Where its send was attempted, with the Matrix transaction ID of that send. */
  destination?: VoiceJournalDestination;
  txnId?: string;
  /** Discarded: deleted once this time has passed, unless the discard is undone. */
  discardUntil?: number;
};

type VoiceJournalChunk = {
  recordingId: string;
  seq: number;
  // The bytes, not the Blob: WebKit refuses to store a Blob in IndexedDB in a private window.
  bytes: ArrayBuffer;
  /** The chunk's own type; the first that has one is the recording's. */
  type: string;
  /** How long the recording was when this chunk arrived. */
  elapsedMs: number;
  /** The waveform samples since the chunk before. */
  samples: number[];
};

/** A recording read back from disk. */
export type JournaledVoiceRecording = {
  record: VoiceJournalRecord;
  file: File;
  duration: number;
  waveform: number[] | undefined;
};

interface VoiceJournalDb extends DBSchema {
  recordings: { key: string; value: VoiceJournalRecord; indexes: { userId: string } };
  chunks: { key: [string, number]; value: VoiceJournalChunk };
}

let connection: Promise<IDBPDatabase<VoiceJournalDb>> | undefined;
const database = (): Promise<IDBPDatabase<VoiceJournalDb>> => {
  connection ??= openDB<VoiceJournalDb>('mindroom-voice-journal', 1, {
    upgrade(db) {
      db.createObjectStore('recordings', { keyPath: 'recordingId' }).createIndex(
        'userId',
        'userId'
      );
      db.createObjectStore('chunks', { keyPath: ['recordingId', 'seq'] });
    },
  });
  // A failed open is tried again by the next write.
  connection.catch(() => {
    connection = undefined;
  });
  return connection;
};

const chunksOf = (recordingId: string) =>
  IDBKeyRange.bound([recordingId, 0], [recordingId, Infinity]);

// Ownership.

/** The recordings this tab owns, each with what gives its lock back. */
const held = new Map<string, () => void>();

/** Takes a recording for this tab, until `release`; false when it cannot be this tab's alone. */
const take = (recordingId: string): Promise<boolean> => {
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  if (!locks || held.has(recordingId)) return Promise.resolve(false);
  return new Promise((resolve) => {
    locks
      .request(`mindroom-voice-recording:${recordingId}`, { ifAvailable: true }, (lock) => {
        if (!lock || held.has(recordingId)) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => {
          held.set(recordingId, release);
        });
      })
      .catch(() => resolve(false));
  });
};

const release = (recordingId: string) => {
  held.get(recordingId)?.();
  held.delete(recordingId);
};

// Writes, one after another per recording.

const lastWrite = new Map<string, Promise<unknown>>();
const inOrder = <T>(recordingId: string, write: () => Promise<T>): Promise<T> => {
  const next = (lastWrite.get(recordingId) ?? Promise.resolve()).then(write);
  lastWrite.set(
    recordingId,
    next.catch(() => undefined)
  );
  return next;
};

type Row = VoiceJournalRecord | VoiceJournalChunk;
/** What each recording still owes the disk, in order: a write that failed is made again first. */
const owed = new Map<string, Promise<Row>[]>();

/** Writes a recording's next row after all it still owes; true once the disk holds all of it. */
const writeAudio = (recordingId: string, row?: Promise<Row>): Promise<boolean> => {
  row?.catch(() => undefined);
  if (row) owed.set(recordingId, [...(owed.get(recordingId) ?? []), row]);
  return inOrder(recordingId, async () => {
    try {
      if (!held.has(recordingId) && !(await take(recordingId))) return false;
      const rows = owed.get(recordingId) ?? [];
      const values = await Promise.all(rows);
      const tx = (await database()).transaction(['recordings', 'chunks'], 'readwrite');
      await Promise.all([
        ...values.map((value) =>
          'seq' in value
            ? tx.objectStore('chunks').put(value)
            : tx.objectStore('recordings').put(value)
        ),
        tx.done,
      ]);
      owed.set(recordingId, (owed.get(recordingId) ?? []).slice(rows.length));
      return true;
    } catch {
      return false;
    }
  });
};

/**
 * Writes later changes to a recording this tab owns: where it goes and its transaction ID, or a
 * discard. False when they did not reach the disk, also because the disk has no such recording.
 */
export const updateVoiceRecording = (
  recordingId: string,
  changes: Partial<Pick<VoiceJournalRecord, 'destination' | 'txnId' | 'discardUntil'>>
): Promise<boolean> =>
  inOrder(recordingId, async () => {
    if (!held.has(recordingId)) return false;
    const tx = (await database()).transaction('recordings', 'readwrite');
    const record = await tx.store.get(recordingId);
    await Promise.all([record && tx.store.put({ ...record, ...changes }), tx.done]);
    return !!record;
  }).catch(() => false);

/**
 * Deletes a recording and gives up its lock: it was sent, it has no audio, or its discard stood.
 * With `expiredBy`, only if the disk says its discard stood until then.
 */
export const deleteVoiceRecording = (recordingId: string, expiredBy?: number): Promise<void> =>
  inOrder(recordingId, async () => {
    const tx = (await database()).transaction(['recordings', 'chunks'], 'readwrite');
    if (expiredBy !== undefined) {
      const until = (await tx.objectStore('recordings').get(recordingId))?.discardUntil;
      if (until === undefined || until > expiredBy) return;
    }
    await Promise.all([
      tx.objectStore('recordings').delete(recordingId),
      tx.objectStore('chunks').delete(chunksOf(recordingId)),
      tx.done,
    ]);
    release(recordingId);
    owed.delete(recordingId);
    lastWrite.delete(recordingId);
  }).catch(() => undefined);

let persistenceAsked = false;

/**
 * What the capture session writes a recording through, for `userId`'s account. `begin` and
 * `append` resolve true while the disk holds all of the recording so far.
 */
export const voiceCaptureJournal = (userId: () => string) => ({
  begin: (meta: { recordingId: string; startedAt: number; mimeType: string }): Promise<boolean> => {
    if (!persistenceAsked) {
      persistenceAsked = true;
      // Best effort: persistent storage is not evicted when the disk runs short.
      globalThis.navigator?.storage?.persist?.().catch(() => undefined);
    }
    return writeAudio(meta.recordingId, Promise.resolve({ userId: userId(), ...meta }));
  },
  /** `seq` is the chunk's place, which the caller assigns as the chunk arrives. */
  append: (
    recordingId: string,
    seq: number,
    { data, elapsedMs, samples }: { data: Blob; elapsedMs: number; samples: number[] }
  ): Promise<boolean> =>
    // Read now, written in turn: the reads of two chunks may finish in either order.
    writeAudio(
      recordingId,
      data
        .arrayBuffer()
        .then((bytes) => ({ recordingId, seq, bytes, type: data.type, elapsedMs, samples }))
    ),
  /** Once more, what a stopped recording still owes the disk. */
  flush: (recordingId: string): Promise<boolean> => writeAudio(recordingId),
  /** The recorder stopped without audio: nothing to keep. */
  abandon: (recordingId: string): void => {
    void deleteVoiceRecording(recordingId);
  },
});

// The copy of a failed send an older version kept, one per account.

type LegacyVoiceDraft = {
  userId: string;
  audio: ArrayBuffer;
  fileType: string;
  duration: number;
  waveform?: number[];
  roomId: string;
  threadId?: string;
  replyDraft?: { eventId: string; relation?: { rel_type?: string; event_id?: string } };
  threadingEnabled: boolean;
  threadView?: boolean;
};

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const [left, right] = [new Uint8Array(a), new Uint8Array(b)];
  return left.length === right.length && left.every((byte, at) => byte === right[at]);
};

const LEGACY_DATABASE = 'mindroom-voice-drafts';
/**
 * Copies the old database's recordings into the journal, where each is an orphan like any other.
 * A copy is named after its account and its audio, so copying again changes nothing. The old
 * database stays, since a tab of the older version may still write to it; of its entries only one
 * that still is what was copied is deleted.
 */
const importLegacyDrafts = async (): Promise<void> => {
  const known = await indexedDB.databases?.();
  if (known && !known.some((entry) => entry.name === LEGACY_DATABASE)) return;
  // Opened the way the older version does, so a browser that cannot list databases creates it right.
  const legacy = await openDB(LEGACY_DATABASE, 1, {
    upgrade: (db) => void db.createObjectStore('drafts', { keyPath: 'userId' }),
  });
  try {
    const drafts: LegacyVoiceDraft[] = await legacy.getAll('drafts');
    /* eslint-disable no-await-in-loop */
    for (const { userId, audio, fileType, duration, waveform, replyDraft, ...to } of drafts) {
      const recordingId = `imported:${userId}:${audio.byteLength}:${duration}`;
      const tx = (await database()).transaction(['recordings', 'chunks'], 'readwrite');
      const copied = await tx.objectStore('recordings').get(recordingId);
      await Promise.all([
        !copied &&
          tx.objectStore('recordings').put({
            userId,
            recordingId,
            startedAt: Date.now(),
            mimeType: fileType,
            destination: {
              roomId: to.roomId,
              threadId: to.threadId,
              replyEventId: replyDraft?.eventId,
              replyThreadId:
                replyDraft?.relation?.rel_type === 'm.thread'
                  ? replyDraft.relation.event_id
                  : undefined,
              threadingEnabled: to.threadingEnabled,
              threadView: to.threadView,
            },
          }),
        !copied &&
          tx.objectStore('chunks').put({
            recordingId,
            seq: 0,
            bytes: audio,
            type: fileType,
            elapsedMs: duration,
            samples: waveform ?? [],
          }),
        tx.done,
      ]);
      const old = legacy.transaction('drafts', 'readwrite');
      const current: LegacyVoiceDraft | undefined = await old.store.get(userId);
      await Promise.all([
        current && sameBytes(current.audio, audio) && old.store.delete(userId),
        old.done,
      ]);
    }
    /* eslint-enable no-await-in-loop */
  } finally {
    legacy.close();
  }
};

// Recovery.

/**
 * The account's recordings no tab owns, oldest first, which this tab owns from now on: left by a
 * crash, a reload or an app update while recording, parked, or sending. One with `discardUntil`
 * was discarded and can still be brought back; one whose discard stood is deleted instead. A
 * recording another tab holds, or that could not be read, is left for a later call.
 */
export const adoptVoiceOrphans = async (
  userId: string,
  now = Date.now()
): Promise<JournaledVoiceRecording[]> => {
  const adopted: JournaledVoiceRecording[] = [];
  if (!globalThis.navigator?.locks) return adopted;
  try {
    // Storage that fails here is asked again by the next call.
    await importLegacyDrafts().catch(() => undefined);
    const db = await database();
    const records = await db.getAllFromIndex('recordings', 'userId', userId);
    records.sort((a, b) => a.startedAt - b.startedAt);
    // One at a time: each is taken before it is read.
    for (const { recordingId } of records) {
      /* eslint-disable no-await-in-loop, no-continue */
      if (!(await take(recordingId))) continue;
      try {
        const record = await db.get('recordings', recordingId);
        const chunks = await db.getAll('chunks', chunksOf(recordingId));
        const lastChunk = chunks.at(-1);
        if (!record || !lastChunk || (record.discardUntil ?? Infinity) <= now) {
          await deleteVoiceRecording(recordingId);
          continue;
        }
        const type = chunks.find((chunk) => chunk.type)?.type || record.mimeType;
        const samples = chunks.flatMap((chunk) => chunk.samples);
        adopted.push({
          record,
          file: new File(
            chunks.map((chunk) => chunk.bytes),
            getVoiceFileName(type, new Date(record.startedAt)),
            { type }
          ),
          duration: Math.max(1, Math.round(lastChunk.elapsedMs)),
          waveform: samples.length > 0 ? normalizeMatrixWaveform(samples) : undefined,
        });
      } catch {
        release(recordingId);
      }
      /* eslint-enable no-await-in-loop, no-continue */
    }
  } catch {
    // The recordings read so far are this tab's; the rest wait for the next call.
  }
  return adopted;
};

/** Forgets the account's recordings, as signing out does. */
export const clearVoiceRecordings = async (userId: string): Promise<void> => {
  try {
    await importLegacyDrafts().catch(() => undefined);
    const ids = await (await database()).getAllKeysFromIndex('recordings', 'userId', userId);
    await Promise.all(ids.map((recordingId) => deleteVoiceRecording(recordingId)));
  } catch {
    // Nothing was kept.
  }
};
