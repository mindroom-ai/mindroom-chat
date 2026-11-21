import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { getVoiceFileName } from './voiceRecorderMime';

/**
 * Every voice recording on disk, from its first second until the server gave its voice event an
 * ID or the person confirmed its Discard. The recorder appends each chunk as it arrives, so a
 * crash, a reload or an app update loses at most the last second.
 *
 * The record here is the truth about a recording, and every change to it is one call of
 * `transitionVoiceRecording`: what shows and what is sent act on its outcome only, after the
 * write. A write that failed leaves the state before it, which is the safer one.
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
  /**
   * The event type its send went out as: `m.room.encrypted`, or `m.room.message` when false. The
   * server tells a repeated send by it too, so the same transaction ID in a room that was
   * encrypted since is another event.
   */
  encrypted?: boolean;
};

export type VoiceJournalRecord = {
  userId: string;
  recordingId: string;
  startedAt: number;
  mimeType: string;
  /** Where its send was attempted, with the Matrix transaction ID of that send. */
  destination?: VoiceJournalDestination;
  txnId?: string;
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
};

/** A recording read back from disk. */
export type JournaledVoiceRecording = { record: VoiceJournalRecord; file: File; duration: number };

/**
 * What a change to a recording came to. `committed`: the disk holds it, and all of the audio.
 * `absent`: the disk has no such recording, because it never took one (no Web Locks, or storage
 * that refused from the start) or it is deleted; it lives in memory at most. `failed`: nothing
 * was written, and the state before stands.
 */
export type VoiceTransitionOutcome = 'committed' | 'absent' | 'failed';

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
    // The browser closed it: the next write opens it again.
    terminated() {
      connection = undefined;
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

type Stores = IDBPTransaction<VoiceJournalDb, ('recordings' | 'chunks')[], 'readwrite'>;
/**
 * One transaction: all of the writes `work` asks for, or none of them. Done, they are on the
 * disk (`strict`), not only handed to the system: what follows a write may be a send.
 */
const atomically = async (work: (tx: Stores) => Promise<unknown>[]): Promise<void> => {
  const tx = (await database()).transaction(['recordings', 'chunks'], 'readwrite', {
    durability: 'strict',
  });
  tx.done.catch(() => undefined);
  try {
    await Promise.all([...work(tx), tx.done]);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* It aborted by itself. */
    }
    throw error;
  }
};
const deleteRows = (recordingId: string) => (tx: Stores) =>
  [
    tx.objectStore('recordings').delete(recordingId),
    tx.objectStore('chunks').delete(chunksOf(recordingId)),
  ];

// Ownership.

/** A recording this tab owns: what gives its lock back, and what the disk does not hold of it. */
type Held = {
  release: () => void;
  /** Its record, while the disk never took one. */
  unstored?: VoiceJournalRecord;
  /** The chunks still to write. The Blobs, which are read again for every try. */
  chunks: { seq: number; data: Blob; elapsedMs: number }[];
};
const held = new Map<string, Held>();

/** Takes a recording for this tab, until `release`; false when it cannot be this tab's alone. */
const take = (recordingId: string, unstored?: VoiceJournalRecord): Promise<boolean> => {
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  if (!locks || held.has(recordingId)) return Promise.resolve(false);
  return new Promise((resolve) => {
    locks
      .request(`mindroom-voice-recording:${recordingId}`, { ifAvailable: true }, (lock) => {
        if (!lock || held.has(recordingId)) {
          resolve(false);
          return undefined;
        }
        return new Promise<void>((release) => {
          held.set(recordingId, { release, unstored, chunks: [] });
          resolve(true);
        });
      })
      .catch(() => resolve(false));
  });
};

const release = (recordingId: string) => {
  held.get(recordingId)?.release();
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

// The copy of a failed send an older version kept, one per account, in its own database.

type LegacyVoiceDraft = {
  userId: string;
  audio: ArrayBuffer;
  fileType: string;
  duration: number;
  roomId: string;
  threadId?: string;
  replyDraft?: { eventId: string; relation?: { rel_type?: string; event_id?: string } };
  threadingEnabled: boolean;
  threadView?: boolean;
};

const LEGACY_DATABASE = 'mindroom-voice-drafts';
/** Runs `work` on the older version's database, if the browser has one. */
const withLegacyDrafts = async <T>(work: (legacy: IDBPDatabase) => Promise<T>): Promise<void> => {
  const known = await indexedDB.databases?.();
  if (known && !known.some((entry) => entry.name === LEGACY_DATABASE)) return;
  // Opened the way the older version does, so a browser that cannot list databases creates it right.
  const legacy = await openDB(LEGACY_DATABASE, 1, {
    upgrade: (db) => void db.createObjectStore('drafts', { keyPath: 'userId' }),
  });
  try {
    await work(legacy);
  } finally {
    legacy.close();
  }
};

/** `unsentVoiceCopy` (unsentMessages.ts): what that version also kept of the same send. */
export type UnsentVoiceCopy = (
  roomId: string,
  size: number
) => { txnId: string; forget: () => void } | undefined;

/**
 * Moves the account's old recording into the journal, where it is an orphan like any other. Its
 * copy is named after the account and the audio, and made only if it is not there, in one
 * transaction: two pages make one copy. Then the old row is deleted, in one transaction that
 * reads it again: one an older version's tab wrote meanwhile holds other audio, stays, and is
 * moved by the next call.
 */
const importLegacyDraft = (userId: string, unsentCopy?: UnsentVoiceCopy): Promise<void> =>
  withLegacyDrafts(async (legacy) => {
    const draft: LegacyVoiceDraft | undefined = await legacy.get('drafts', userId);
    if (!draft) return;
    const { audio, fileType, duration, replyDraft, ...to } = draft;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', audio));
    const recordingId = `legacy-${userId}-${Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')}`;
    // A retry that version was cut short in: sent again, the recording is that same event.
    const copy = unsentCopy?.(to.roomId, audio.byteLength);
    const record: VoiceJournalRecord = {
      userId,
      recordingId,
      startedAt: Date.now(),
      mimeType: fileType,
      txnId: copy?.txnId,
      destination: {
        roomId: to.roomId,
        threadId: to.threadId,
        replyEventId: replyDraft?.eventId,
        replyThreadId:
          replyDraft?.relation?.rel_type === 'm.thread' ? replyDraft.relation.event_id : undefined,
        threadingEnabled: to.threadingEnabled,
        threadView: to.threadView,
        // Only a message that was not encrypted is kept among the unsent ones.
        encrypted: copy && false,
      },
    };
    const chunk = { recordingId, seq: 0, bytes: audio, type: fileType, elapsedMs: duration };
    await atomically((tx) => {
      const recordings = tx.objectStore('recordings');
      const copyOnce = async (): Promise<unknown> =>
        (await recordings.get(recordingId)) ??
        Promise.all([recordings.put(record), tx.objectStore('chunks').put(chunk)]);
      return [copyOnce()];
    });
    copy?.forget();
    const old = legacy.transaction('drafts', 'readwrite');
    const now: LegacyVoiceDraft | undefined = await old.store.get(userId);
    if (now && indexedDB.cmp(now.audio, audio) === 0) await old.store.delete(userId);
    await old.done;
  });

/**
 * The one way a recording this tab owns changes on disk. `change` gets its record and returns
 * what the record becomes, or nothing to delete the recording; left out, only the audio the disk
 * does not hold yet is written, which every call does along with its change. See
 * `VoiceTransitionOutcome` for what the caller may do next.
 */
export const transitionVoiceRecording = (
  recordingId: string,
  change: (record: VoiceJournalRecord) => VoiceJournalRecord | undefined = (record) => record
): Promise<VoiceTransitionOutcome> =>
  inOrder(recordingId, async () => {
    const mine = held.get(recordingId);
    if (!mine) return 'absent';
    const stored = !mine.unstored;
    try {
      const before = mine.unstored ?? (await (await database()).get('recordings', recordingId));
      const after = before && change(before);
      // A recording the disk never took changes in memory.
      if (!stored) mine.unstored = after;
      if (after) {
        const chunks = await Promise.all(
          mine.chunks.map(async ({ data, ...at }) => ({
            ...at,
            recordingId,
            type: data.type,
            bytes: await data.arrayBuffer(),
          }))
        );
        await atomically((tx) => [
          tx.objectStore('recordings').put(after),
          ...chunks.map((chunk) => tx.objectStore('chunks').put(chunk)),
        ]);
        mine.unstored = undefined;
        mine.chunks.splice(0, chunks.length);
        return 'committed';
      }
      if (stored && before) await atomically(deleteRows(recordingId));
      release(recordingId);
      lastWrite.delete(recordingId);
      return stored && before ? 'committed' : 'absent';
    } catch {
      return stored ? 'failed' : 'absent';
    }
  });

let persistenceAsked = false;

/**
 * What the capture session writes a recording through, for `userId`'s account. `begin` and
 * `append` resolve true while the disk holds all of the recording so far.
 */
export const voiceCaptureJournal = (userId: () => string) => {
  const write = (recordingId: string, first: () => Promise<unknown>): Promise<boolean> =>
    inOrder(recordingId, first)
      .then(() => transitionVoiceRecording(recordingId))
      .then((outcome) => outcome === 'committed');
  return {
    begin: (meta: { recordingId: string; startedAt: number; mimeType: string }) => {
      if (!persistenceAsked) {
        persistenceAsked = true;
        // Best effort: persistent storage is not evicted when the disk runs short.
        globalThis.navigator?.storage?.persist?.().catch(() => undefined);
      }
      return write(meta.recordingId, () => take(meta.recordingId, { userId: userId(), ...meta }));
    },
    /** `seq` is the chunk's place, which the caller assigns as the chunk arrives. */
    append: (recordingId: string, seq: number, chunk: { data: Blob; elapsedMs: number }) =>
      // A recording this tab could not take keeps no second copy of its audio.
      write(recordingId, async () => held.get(recordingId)?.chunks.push({ seq, ...chunk })),
    /** The recorder stopped without audio: nothing to keep. */
    abandon: (recordingId: string): void => {
      void transitionVoiceRecording(recordingId, () => undefined);
    },
  };
};

// Recovery.

/**
 * The account's recordings no tab owns, oldest first, which this tab owns from now on: left by a
 * crash, a reload or an app update while recording, parked, or sending. A recording another tab
 * holds, or that could not be read, is left for a later call.
 */
export const adoptVoiceOrphans = async (
  userId: string,
  unsentCopy?: UnsentVoiceCopy
): Promise<JournaledVoiceRecording[]> => {
  const adopted: JournaledVoiceRecording[] = [];
  if (!globalThis.navigator?.locks) return adopted;
  try {
    // Storage that fails here is asked again by the next call.
    await importLegacyDraft(userId, unsentCopy).catch(() => undefined);
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
        if (!record || !lastChunk) {
          await transitionVoiceRecording(recordingId, () => undefined);
          continue;
        }
        const type = chunks.find((chunk) => chunk.type)?.type || record.mimeType;
        adopted.push({
          record,
          file: new File(
            chunks.map((chunk) => chunk.bytes),
            getVoiceFileName(type, new Date(record.startedAt)),
            { type }
          ),
          duration: Math.max(1, Math.round(lastChunk.elapsedMs)),
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

/** Forgets the account's recordings, whoever holds them, as signing out does. */
export const clearVoiceRecordings = async (userId: string): Promise<void> => {
  try {
    await withLegacyDrafts((legacy) => legacy.delete('drafts', userId));
    const ids = await (await database()).getAllKeysFromIndex('recordings', 'userId', userId);
    await Promise.all(
      ids.map(async (recordingId) => {
        await atomically(deleteRows(recordingId));
        release(recordingId);
      })
    );
  } catch {
    // Nothing was kept.
  }
};
