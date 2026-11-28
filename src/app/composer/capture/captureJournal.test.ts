import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  beginDictationJournal,
  beginVoiceRecording,
  clearCaptureJournal,
  hasDictationJournalRecord,
  recoverDictationJournal,
  recoverVoiceRecording,
  releaseCapture,
  type DictationJournalMeta,
  type PersistedDictationSegment,
} from './captureJournal';

const USER = '@capture-journal:example.org';
const OTHER = '@capture-other:example.org';
const SESSION_A = 'https%3A%2F%2Fhs-a.example.org::%40capture-journal%3Aexample.org';
const SESSION_B = 'https%3A%2F%2Fhs-b.example.org::%40capture-journal%3Aexample.org';

beforeEach(() => {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async <T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>) => {
        expect(options.ifAvailable).toBe(true);
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name, mode: 'exclusive' });
        } finally {
          held.delete(name);
        }
      },
    },
  });
});

afterEach(async () => {
  await clearCaptureJournal(USER);
  await clearCaptureJournal(OTHER);
  await clearCaptureJournal(SESSION_A);
  await clearCaptureJournal(SESSION_B);
  vi.unstubAllGlobals();
});

const beginVoice = (user = USER) => beginVoiceRecording(user, Date.now(), 'audio/ogg')!;

const makeSegment = (
  index: number,
  overrides: Partial<PersistedDictationSegment> = {}
): PersistedDictationSegment => ({
  index,
  seconds: 1.5,
  overlapped: false,
  cutReason: 'natural',
  leadingQuietFrames: 0,
  trailingQuietFrames: 2,
  pauseBeforeMs: 0,
  status: 'queued',
  retryable: true,
  ...overrides,
});

const makeMeta = (overrides: Partial<DictationJournalMeta> = {}): DictationJournalMeta => ({
  startedAt: 1_700_000_000_000,
  elapsedMs: 0,
  originApiUrl: 'https://server.example.org',
  originRoomId: '!room:example.org',
  segments: [],
  groups: [],
  ...overrides,
});

const pcmFrames = (frameCount: number, tag: number): ArrayBuffer => {
  const samples = new Int16Array(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    samples[frame * 2] = tag;
    samples[frame * 2 + 1] = frame;
  }
  return samples.buffer;
};

it('writes voice chunks in sequence despite out-of-order byte conversion, using the first chunk MIME', async () => {
  const recording = beginVoice();
  const first = new Blob(['first'], { type: 'audio/webm' });
  const bytes = await first.arrayBuffer();
  let resolveFirst!: (value: ArrayBuffer) => void;
  vi.spyOn(first, 'arrayBuffer').mockReturnValue(
    new Promise((resolve) => {
      resolveFirst = resolve;
    })
  );
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  const second = new Blob(['second'], { type: 'audio/mp4' });
  const secondBytes = await second.arrayBuffer();
  vi.spyOn(second, 'arrayBuffer').mockResolvedValue(secondBytes);
  const a = recording.append(0, first, 1_000);
  const b = recording.append(1, second, 2_000);
  await Promise.resolve();
  resolveFirst(bytes);
  await Promise.all([a, b]);
  expect(put.mock.calls.map(([chunk]) => (chunk as { seq: number }).seq)).toEqual([0, 1]);
  put.mockRestore();
  releaseCapture(recording.id);

  const offer = vi.fn((_draft: { file: File; duration: number }) => true);
  await recoverVoiceRecording(USER, undefined, offer);
  const [draft] = offer.mock.calls[0]!;
  expect(await draft.file.text()).toBe('firstsecond');
  expect(draft.file.type).toBe('audio/webm');
  expect(draft.duration).toBe(2_000);
});

it('recovers legacy v1 voice rows that lack a kind field and ignores them in dictation recovery', async () => {
  const db = await openDB('mindroom-voice-journal', 1, {
    upgrade(upgradeDb) {
      upgradeDb.createObjectStore('recordings', { keyPath: 'id' }).createIndex('userId', 'userId');
      upgradeDb.createObjectStore('chunks', { keyPath: ['id', 'seq'] });
    },
  });
  const legacyId = 'legacy-v1-voice';
  await db.put('recordings', {
    id: legacyId,
    userId: USER,
    startedAt: 1_600_000_000_000,
    mimeType: 'audio/ogg',
  });
  await db.put('chunks', {
    id: legacyId,
    seq: 0,
    bytes: new TextEncoder().encode('legacy-voice').buffer,
    type: 'audio/ogg',
    elapsedMs: 3_500,
  });
  db.close();

  expect(await hasDictationJournalRecord(USER)).toBe(false);
  const dictationOffer = vi.fn(() => true);
  await recoverDictationJournal(USER, dictationOffer);
  expect(dictationOffer).not.toHaveBeenCalled();

  const voiceOffer = vi.fn((_draft: { recordingId: string; file: File; duration: number }) => true);
  await recoverVoiceRecording(USER, undefined, voiceOffer);
  expect(voiceOffer).toHaveBeenCalledOnce();
  const [recovered] = voiceOffer.mock.calls[0]!;
  expect(recovered.recordingId).toBe(legacyId);
  expect(await recovered.file.text()).toBe('legacy-voice');
  expect(recovered.duration).toBe(3_500);
  releaseCapture(legacyId);
});

it('offers only unlocked voice records, and releases one the draft slot cannot take', async () => {
  const active = beginVoice();
  const orphan = beginVoice();
  await Promise.all([
    active.append(0, new Blob(['active']), 1_000),
    orphan.append(0, new Blob(['orphan']), 1_000),
  ]);
  releaseCapture(orphan.id);
  const busy = vi.fn(() => false);
  await recoverVoiceRecording(USER, undefined, busy);
  expect(busy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recordingId: orphan.id }));

  const free = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, free);
  expect(free).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recordingId: orphan.id }));
  const again = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, again);
  expect(again).not.toHaveBeenCalled();
});

it('prunes only fully obsolete tail rows and writes no empty or obsolete replacement', async () => {
  const journal = beginDictationJournal(SESSION_A, makeMeta())!;
  await journal.appendTail(0, pcmFrames(10, 1), 960, 0, 10);
  await journal.appendTail(1, pcmFrames(10, 2), 1_920, 10, 20);
  await journal.appendTail(2, pcmFrames(4, 3), 2_304, 8, 12, 12);
  journal.release();
  await Promise.resolve();

  await recoverDictationJournal(SESSION_A, async ({ meta, tailChunks, journal: recovered }) => {
    expect(meta.elapsedMs).toBe(2_304);
    expect(tailChunks).toMatchObject([{ seq: 1, startFramePos: 10, endFramePos: 20 }]);
    await recovered.appendTail(3, null, 2_400, 20, 20, 20);
    recovered.release();
    return true;
  });
  await Promise.resolve();
  const offer = vi.fn(() => false);
  await recoverDictationJournal(SESSION_A, offer);
  expect(offer).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      tailChunks: [],
      meta: expect.objectContaining({ elapsedMs: 2_400 }),
    })
  );
});

it('persists dictation tail chunks, drops fully-consumed chunks via consumedThroughFramePos, and prunes locked WAVs', async () => {
  const journal = beginDictationJournal(SESSION_A, makeMeta())!;
  expect(journal).toBeDefined();

  // Append 3 tail chunks covering frames [0, 10), [10, 20), [20, 26).
  await journal.appendTail(0, pcmFrames(10, 1), 960, 0, 10);
  await journal.appendTail(1, pcmFrames(10, 2), 1_920, 10, 20);
  await journal.appendTail(2, pcmFrames(6, 3), 2_496, 20, 26);

  // Hard cut emits segment 0 with consumedThroughFramePos = 18:
  // chunk 0 [0, 10) is fully consumed and deleted; chunks 1 [10, 20) and 2 [20, 26) stay intact.
  const wav0 = new Uint8Array([1, 2, 3, 4]).buffer;
  const metaAfterSeg0 = makeMeta({
    elapsedMs: 2_496,
    consumedThroughFramePos: 18,
    segments: [makeSegment(0)],
    groups: [{ startIndex: 0, endIndex: 0, state: 'open' }],
  });
  await journal.commitSegment(0, wav0, metaAfterSeg0);

  // Emit segment 1 and prune the now-settled segment 0 WAV in the same write.
  const wav1 = new Uint8Array([5, 6, 7, 8]).buffer;
  const metaPruned = makeMeta({
    elapsedMs: 3_500,
    consumedThroughFramePos: 18,
    segments: [
      makeSegment(0, { status: 'completed', text: 'hello' }),
      makeSegment(1, { overlapped: true, cutReason: 'hard' }),
    ],
    groups: [
      { startIndex: 0, endIndex: 0, state: 'fallback' },
      { startIndex: 1, endIndex: 1, state: 'fallback' },
    ],
  });
  await journal.commitSegment(1, wav1, metaPruned, [0]);

  expect(await hasDictationJournalRecord(SESSION_A)).toBe(true);
  expect(await hasDictationJournalRecord(SESSION_B)).toBe(false);
  // Locked while active, so recovery skips it and voice recovery never sees it.
  const lockedOffer = vi.fn(() => true);
  await recoverDictationJournal(SESSION_A, lockedOffer);
  expect(lockedOffer).not.toHaveBeenCalled();
  const voiceOffer = vi.fn(() => true);
  await recoverVoiceRecording(SESSION_A, undefined, voiceOffer);
  expect(voiceOffer).not.toHaveBeenCalled();

  journal.release();
  await Promise.resolve();

  // Recovery delivers segment 1 WAV (segment 0 was pruned), consumedThroughFramePos=18, and intact chunks 1 & 2.
  let recovered: Parameters<Parameters<typeof recoverDictationJournal>[1]>[0] | undefined;
  await recoverDictationJournal(SESSION_A, (entry) => {
    recovered = entry;
    return true;
  });

  expect(recovered).toBeDefined();
  expect(recovered!.id).toBe(journal.id);
  expect(recovered!.meta.consumedThroughFramePos).toBe(18);
  expect(recovered!.meta.segments).toHaveLength(2);
  expect(recovered!.meta.segments[0]?.text).toBe('hello');
  expect([...recovered!.wavs.keys()]).toEqual([1]);
  expect(new Uint8Array(recovered!.wavs.get(1)!)).toEqual(new Uint8Array([5, 6, 7, 8]));
  expect(recovered!.tailChunks).toHaveLength(2);
  expect(recovered!.tailChunks[0]).toMatchObject({ seq: 1, startFramePos: 10, endFramePos: 20 });
  expect(recovered!.tailChunks[1]).toMatchObject({ seq: 2, startFramePos: 20, endFramePos: 26 });

  // Clearing all tail chunks also clears consumedThroughFramePos.
  await recovered!.journal.updateState(metaPruned, undefined, true);
  recovered!.journal.release();
  await Promise.resolve();

  let afterClearTail: Parameters<Parameters<typeof recoverDictationJournal>[1]>[0] | undefined;
  await recoverDictationJournal(SESSION_A, (entry) => {
    afterClearTail = entry;
    return false;
  });
  expect(afterClearTail?.tailChunks).toEqual([]);
  expect(afterClearTail?.meta.consumedThroughFramePos).toBeUndefined();
  // Rejected recovery unlocked it, so remove cleans it up cleanly.
  await afterClearTail!.journal.remove();
  expect(await hasDictationJournalRecord(SESSION_A)).toBe(false);
});

it('recovers dictation records oldest-first and retains text-only records with zero WAVs', async () => {
  const newer = beginDictationJournal(SESSION_A, makeMeta({ startedAt: 2_000 }))!;
  const older = beginDictationJournal(SESSION_A, makeMeta({ startedAt: 1_000 }))!;
  await older.updateState(
    makeMeta({
      startedAt: 1_000,
      elapsedMs: 4_000,
      segments: [makeSegment(0, { status: 'completed', text: 'already transcribed' })],
    })
  );
  await newer.updateState(makeMeta({ startedAt: 2_000, elapsedMs: 1_000 }));
  older.release();
  newer.release();
  await Promise.resolve();

  const seen: string[] = [];
  await recoverDictationJournal(SESSION_A, (entry) => {
    seen.push(entry.id);
    if (entry.id === older.id) {
      expect(entry.wavs.size).toBe(0);
      expect(entry.tailChunks).toEqual([]);
      expect(entry.meta.segments[0]?.text).toBe('already transcribed');
      return true;
    }
    return false;
  });
  expect(seen).toEqual([older.id]);
  releaseCapture(older.id);
});

it('sign-out removes only rows for the cleared owner key (session-scoped dictation vs user-scoped voice)', async () => {
  const activeVoice = beginVoice();
  const sessionADictation = beginDictationJournal(SESSION_A, makeMeta())!;
  const sessionBDictation = beginDictationJournal(SESSION_B, makeMeta())!;
  const otherVoice = beginVoice(OTHER);

  const writingVoice = activeVoice.append(0, new Blob(['active']), 1_000);
  const writingDictation = sessionADictation.appendTail(0, pcmFrames(2, 9), 200, 0, 2);
  await otherVoice.append(0, new Blob(['other']), 1_000);
  await sessionBDictation.appendTail(0, pcmFrames(2, 7), 200, 0, 2);

  // Signing out SESSION_A clears SESSION_A dictation without touching SESSION_B dictation or USER voice.
  const clearingSessionA = clearCaptureJournal(SESSION_A);
  await Promise.all([writingVoice, writingDictation, clearingSessionA]);
  releaseCapture(activeVoice.id);
  sessionADictation.release();
  sessionBDictation.release();
  releaseCapture(otherVoice.id);
  await Promise.resolve();

  expect(await hasDictationJournalRecord(SESSION_A)).toBe(false);
  expect(await hasDictationJournalRecord(SESSION_B)).toBe(true);

  const voiceOffer = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, voiceOffer);
  expect(voiceOffer).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ recordingId: activeVoice.id })
  );
  releaseCapture(activeVoice.id);

  // Clearing USER removes USER voice without touching OTHER voice or SESSION_B dictation.
  await clearCaptureJournal(USER);
  voiceOffer.mockClear();
  await recoverVoiceRecording(USER, undefined, voiceOffer);
  expect(voiceOffer).not.toHaveBeenCalled();
  await recoverVoiceRecording(OTHER, undefined, voiceOffer);
  expect(voiceOffer).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ recordingId: otherVoice.id })
  );
  expect(await hasDictationJournalRecord(SESSION_B)).toBe(true);
});

it('keeps a chunk still being written when the lock is given up', async () => {
  const recording = beginVoice();
  const written = recording.append(0, new Blob(['queued']), 1_000);
  releaseCapture(recording.id);
  await written;
  const offer = vi.fn((_draft: { file: File }) => true);
  await recoverVoiceRecording(USER, undefined, offer);
  expect(await offer.mock.calls[0]![0].file.text()).toBe('queued');
});

it('does not journal on browsers without Web Locks', async () => {
  vi.stubGlobal('navigator', {});
  expect(beginVoiceRecording(USER, Date.now(), 'audio/ogg')).toBeUndefined();
  expect(beginDictationJournal(SESSION_A, makeMeta())).toBeUndefined();
  expect(await hasDictationJournalRecord(SESSION_A)).toBe(false);
});
