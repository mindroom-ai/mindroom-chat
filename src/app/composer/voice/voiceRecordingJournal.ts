import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { normalizeMatrixWaveform } from '../../lib/audioWaveform';
import type { IReplyDraft } from '../roomInputDrafts';
import { getVoiceFileName } from './voiceRecorderMime';

/**
 * Every voice recording on disk, from its first second until the server accepted its voice event
 * or the person let a Discard stand. The recorder appends each chunk as it arrives, so a crash,
 * a reload or an app update loses at most the last second; what sends it writes where it goes and
 * its Matrix transaction ID before the upload starts, so a retry after a crash posts it once.
 *
 * The tab that owns a recording holds the Web Lock named after it, from before its first write
 * until it deletes the record. A record nobody holds is an orphan, which the next page adopts.
 */

/** Where a recording goes, as it is kept on disk: no live `Room`. */
export type VoiceJournalDestination = {
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
  threadView?: boolean;
};

export type VoiceJournalRecord = {
  userId: string;
  recordingId: string;
  startedAt: number;
  mimeType: string;
  stoppedAt?: number;
  destination?: VoiceJournalDestination;
  /** The Matrix transaction ID of its send. */
  txnId?: string;
  /** Discarded: deleted once this time has passed, unless the discard is undone. */
  discardUntil?: number;
  errorMessage?: string;
};

type VoiceJournalChunk = {
  recordingId: string;
  seq: number;
  // The bytes, not the Blob: WebKit refuses to store a Blob in IndexedDB in a private window.
  bytes: ArrayBuffer;
  /** How long the recording was when this chunk arrived. */
  elapsedMs: number;
  /** The waveform samples since the chunk before. */
  samples: number[];
  writtenAt: number;
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

const locks: LockManager | undefined = globalThis.navigator?.locks;
/** The recordings this tab owns, each with what gives its lock back. */
const held = new Map<string, () => void>();

/** Takes a recording for this tab, until `release`; false when it is taken already. */
const take = (recordingId: string): Promise<boolean> => {
  if (held.has(recordingId)) return Promise.resolve(false);
  if (!locks) {
    held.set(recordingId, () => undefined);
    return Promise.resolve(true);
  }
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

/** Recordings with a failed audio write: no later chunk is written, so the disk keeps a clean prefix. */
const broken = new Set<string>();
const writeAudio = (
  recordingId: string,
  write: (db: IDBPDatabase<VoiceJournalDb>) => Promise<unknown>
): Promise<boolean> =>
  inOrder(recordingId, async () => {
    if (broken.has(recordingId)) return false;
    try {
      await write(await database());
      return true;
    } catch {
      broken.add(recordingId);
      return false;
    }
  });

/** Writes later changes to a recording's record: where it goes, its transaction ID, a discard. */
export const updateVoiceRecording = (
  recordingId: string,
  changes: Partial<
    Pick<
      VoiceJournalRecord,
      'stoppedAt' | 'destination' | 'txnId' | 'discardUntil' | 'errorMessage'
    >
  >
): Promise<void> =>
  inOrder(recordingId, async () => {
    const tx = (await database()).transaction('recordings', 'readwrite');
    const record = await tx.store.get(recordingId);
    if (record) await tx.store.put({ ...record, ...changes });
    await tx.done;
  }).catch(() => undefined);

/** Deletes a recording that was sent or discarded, and gives up its lock. */
export const deleteVoiceRecording = (recordingId: string): Promise<void> =>
  inOrder(recordingId, async () => {
    const tx = (await database()).transaction(['recordings', 'chunks'], 'readwrite');
    await tx.objectStore('recordings').delete(recordingId);
    await tx.objectStore('chunks').delete(chunksOf(recordingId));
    await tx.done;
    release(recordingId);
    broken.delete(recordingId);
    lastWrite.delete(recordingId);
  }).catch(() => undefined);

let persistenceAsked = false;

/**
 * What the capture session writes a recording through, for `userId`'s account. `begin` and
 * `append` resolve false when the recording is not protected against a crash.
 */
export const voiceCaptureJournal = (userId: () => string) => ({
  begin: (meta: { recordingId: string; startedAt: number; mimeType: string }): Promise<boolean> => {
    if (!persistenceAsked) {
      persistenceAsked = true;
      // Best effort: persistent storage is not evicted when the disk runs short.
      globalThis.navigator?.storage?.persist?.().catch(() => undefined);
    }
    const record = { userId: userId(), ...meta };
    return writeAudio(meta.recordingId, async (db) => {
      if (!(await take(meta.recordingId))) throw new Error('Recording is owned elsewhere.');
      await db.put('recordings', record);
    });
  },
  /** `seq` is the chunk's place, which the caller assigns as the chunk arrives. */
  append: (
    recordingId: string,
    seq: number,
    chunk: { data: Blob; elapsedMs: number; samples: number[] }
  ): Promise<boolean> => {
    // Read now, written in turn: the reads of two chunks may finish in either order.
    const bytes = chunk.data.arrayBuffer().catch(() => undefined);
    const { elapsedMs, samples } = chunk;
    return writeAudio(recordingId, async (db) => {
      const read = await bytes;
      if (!read) throw new Error('Chunk could not be read.');
      await db.put('chunks', {
        recordingId,
        seq,
        bytes: read,
        elapsedMs,
        samples,
        writtenAt: Date.now(),
      });
    });
  },
  /** The recorder stopped: with audio the record stays for its send or discard. */
  stop: (recordingId: string, hasAudio: boolean): void => {
    if (hasAudio) void updateVoiceRecording(recordingId, { stoppedAt: Date.now() });
    else void deleteVoiceRecording(recordingId);
  },
});

// The copy of a failed send an older version kept, one per account.

type LegacyVoiceDraft = VoiceJournalDestination & {
  userId: string;
  audio: ArrayBuffer;
  fileType: string;
  duration: number;
  waveform?: number[];
  errorMessage?: string;
};

const LEGACY_DATABASE = 'mindroom-voice-drafts';
let legacyImport: Promise<void> | undefined;
/** Moves the old database's recordings into the journal and deletes it, once a page. */
const importLegacyDrafts = (): Promise<void> => {
  legacyImport ??= (async () => {
    const known = await indexedDB.databases?.();
    if (known && !known.some((entry) => entry.name === LEGACY_DATABASE)) return;
    const legacy = await openDB(LEGACY_DATABASE);
    const drafts: LegacyVoiceDraft[] = legacy.objectStoreNames.contains('drafts')
      ? await legacy.getAll('drafts')
      : [];
    legacy.close();
    const tx = (await database()).transaction(['recordings', 'chunks'], 'readwrite');
    const now = Date.now();
    drafts.forEach(
      ({ userId, audio, fileType, duration, waveform, errorMessage, ...destination }) => {
        // Named after its account, so an import that is cut short and runs again writes it once.
        const recordingId = `imported:${userId}`;
        void tx.objectStore('recordings').put({
          userId,
          recordingId,
          startedAt: now,
          stoppedAt: now,
          mimeType: fileType,
          destination,
          errorMessage,
        });
        void tx.objectStore('chunks').put({
          recordingId,
          seq: 0,
          bytes: audio,
          elapsedMs: duration,
          samples: waveform ?? [],
          writtenAt: 0,
        });
      }
    );
    await tx.done;
    await deleteDB(LEGACY_DATABASE);
  })().catch(() => undefined);
  return legacyImport;
};

// Recovery.

/** Without Web Locks, a recording counts as abandoned only after this long without a write. */
const ORPHAN_QUIET_MS = 10 * 60_000;

/**
 * The account's recordings no tab owns, oldest first, which this tab owns from now on: left by a
 * crash, a reload or an app update while recording, parked, or sending. A recording whose discard
 * stood is deleted instead.
 */
export const adoptVoiceOrphans = async (
  userId: string,
  { now = Date.now(), loadedAt = performance.timeOrigin } = {}
): Promise<JournaledVoiceRecording[]> => {
  try {
    await importLegacyDrafts();
    const db = await database();
    const records = await db.getAllFromIndex('recordings', 'userId', userId);
    records.sort((a, b) => a.startedAt - b.startedAt);
    const adopted: JournaledVoiceRecording[] = [];
    // One at a time: each is taken before it is read.
    for (const { recordingId, startedAt } of records) {
      /* eslint-disable no-await-in-loop, no-continue */
      if (held.has(recordingId)) continue;
      if (!locks) {
        // A tab that is only suspended writes nothing either, so a live recording must look dead
        // for a long time, and from before this page existed, to count as abandoned.
        const last = (await db.getAll('chunks', chunksOf(recordingId))).at(-1);
        const quietSince = last?.writtenAt ?? startedAt;
        if (quietSince > now - ORPHAN_QUIET_MS || quietSince > loadedAt) continue;
      }
      if (!(await take(recordingId))) continue;
      const record = await db.get('recordings', recordingId);
      const chunks = await db.getAll('chunks', chunksOf(recordingId));
      const lastChunk = chunks.at(-1);
      const { discardUntil } = record ?? {};
      if (!record || !lastChunk || (discardUntil !== undefined && discardUntil <= now)) {
        await deleteVoiceRecording(recordingId);
        continue;
      }
      if (discardUntil !== undefined) {
        setTimeout(() => void deleteVoiceRecording(recordingId), discardUntil - now);
        continue;
      }
      /* eslint-enable no-await-in-loop, no-continue */
      const samples = chunks.flatMap((chunk) => chunk.samples);
      adopted.push({
        record,
        file: new File(
          chunks.map((chunk) => chunk.bytes),
          getVoiceFileName(record.mimeType, new Date(record.startedAt)),
          { type: record.mimeType }
        ),
        duration: Math.max(1, Math.round(lastChunk.elapsedMs)),
        waveform: samples.length > 0 ? normalizeMatrixWaveform(samples) : undefined,
      });
    }
    return adopted;
  } catch {
    // Storage that fails (private mode, full disk) has nothing to recover.
    return [];
  }
};

/** Forgets the account's recordings, as signing out does. */
export const clearVoiceRecordings = async (userId: string): Promise<void> => {
  try {
    await importLegacyDrafts();
    const ids = await (await database()).getAllKeysFromIndex('recordings', 'userId', userId);
    await Promise.all(ids.map(deleteVoiceRecording));
  } catch {
    // Nothing was kept.
  }
};
