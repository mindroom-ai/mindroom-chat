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
  releaseVoiceRecording,
  type DictationJournalMeta,
  type PersistedDictationSegment,
} from './captureJournal';

const USER = '@capture-journal:example.org';
const OTHER = '@capture-other:example.org';

beforeEach(() => {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, options: LockOptions, callback: LockGrantedCallback) => {
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
  hasWav: true,
  ...overrides,
});

const makeMeta = (overrides: Partial<DictationJournalMeta> = {}): DictationJournalMeta => ({
  startedAt: 1_700_000_000_000,
  elapsedMs: 0,
  capReached: false,
  originApiUrl: 'https://server.example.org',
  originRoomId: '!room:example.org',
  segments: [],
  groups: [],
  ...overrides,
});

const pcmFrames = (frameCount: number, tag: number): ArrayBuffer => {
  // 4 bytes per frame (2 Int16 samples) is enough to test exact frame slicing math.
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
  releaseVoiceRecording(recording.id);

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
  releaseVoiceRecording(legacyId);
});

it('offers only unlocked voice records, and releases one the draft slot cannot take', async () => {
  const active = beginVoice();
  const orphan = beginVoice();
  await Promise.all([
    active.append(0, new Blob(['active']), 1_000),
    orphan.append(0, new Blob(['orphan']), 1_000),
  ]);
  releaseVoiceRecording(orphan.id);
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

it('persists dictation tail chunks, trims partially consumed tails on hard cut, and prunes locked WAVs', async () => {
  const journal = beginDictationJournal(USER, makeMeta())!;
  expect(journal).toBeDefined();

  // Append 3 tail chunks covering frames [0, 10), [10, 20), [20, 26).
  await journal.appendTail(0, pcmFrames(10, 1), 960, 0, 10);
  await journal.appendTail(1, pcmFrames(10, 2), 1_920, 10, 20);
  await journal.appendTail(2, pcmFrames(6, 3), 2_496, 20, 26);

  // Hard cut emits segment 0 and consumes frames < 18, retaining [18, 20) from chunk 1 and [20, 26) from chunk 2.
  const wav0 = new Uint8Array([1, 2, 3, 4]).buffer;
  const metaAfterSeg0 = makeMeta({
    elapsedMs: 2_496,
    segments: [makeSegment(0)],
    groups: [{ startIndex: 0, endIndex: 0, state: 'open' }],
  });
  await journal.commitSegment(0, wav0, metaAfterSeg0, 18);

  // Emit segment 1 with no further tail clearing, then lock segment 0 and prune its WAV.
  const wav1 = new Uint8Array([5, 6, 7, 8]).buffer;
  const metaAfterSeg1 = makeMeta({
    elapsedMs: 3_500,
    segments: [
      makeSegment(0, { status: 'completed', text: 'hello', hasWav: true }),
      makeSegment(1, { overlapped: true, cutReason: 'hard' }),
    ],
    groups: [{ startIndex: 0, endIndex: 1, state: 'open' }],
  });
  await journal.commitSegment(1, wav1, metaAfterSeg1);

  const metaPruned = makeMeta({
    elapsedMs: 3_500,
    segments: [
      makeSegment(0, { status: 'completed', text: 'hello', hasWav: false }),
      makeSegment(1, { overlapped: true, cutReason: 'hard' }),
    ],
    groups: [
      { startIndex: 0, endIndex: 1, state: 'refined', refinedText: 'Hello', refinedEndIndex: 0 },
    ],
  });
  await journal.updateState(metaPruned, [0]);

  expect(await hasDictationJournalRecord(USER)).toBe(true);
  // Locked while active, so recovery skips it and voice recovery never sees it.
  const lockedOffer = vi.fn(() => true);
  await recoverDictationJournal(USER, lockedOffer);
  expect(lockedOffer).not.toHaveBeenCalled();
  const voiceOffer = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, voiceOffer);
  expect(voiceOffer).not.toHaveBeenCalled();

  journal.release();
  await Promise.resolve();

  // Recovery delivers segment 1 WAV (segment 0 was pruned), trimmed tail chunk 1 [18, 20), and chunk 2 [20, 26).
  let recovered: Parameters<Parameters<typeof recoverDictationJournal>[1]>[0] | undefined;
  await recoverDictationJournal(USER, (entry) => {
    recovered = entry;
    return true;
  });

  expect(recovered).toBeDefined();
  expect(recovered!.id).toBe(journal.id);
  expect(recovered!.meta.segments).toHaveLength(2);
  expect(recovered!.meta.segments[0]?.text).toBe('hello');
  expect(recovered!.meta.segments[0]?.hasWav).toBe(false);
  expect([...recovered!.wavs.keys()]).toEqual([1]);
  expect(new Uint8Array(recovered!.wavs.get(1)!)).toEqual(new Uint8Array([5, 6, 7, 8]));
  expect(recovered!.tailChunks).toHaveLength(2);
  expect(recovered!.tailChunks[0]).toMatchObject({ seq: 1, startFramePos: 18, endFramePos: 20 });
  expect(new Int16Array(recovered!.tailChunks[0]!.bytes)).toEqual(new Int16Array([2, 8, 2, 9]));
  expect(recovered!.tailChunks[1]).toMatchObject({ seq: 2, startFramePos: 20, endFramePos: 26 });

  // The recovered handle can clear all tail chunks and remove the record.
  await recovered!.journal.updateState(metaPruned, undefined, true);
  recovered!.journal.release();
  await Promise.resolve();

  let afterClearTail: Parameters<Parameters<typeof recoverDictationJournal>[1]>[0] | undefined;
  await recoverDictationJournal(USER, (entry) => {
    afterClearTail = entry;
    return false;
  });
  expect(afterClearTail?.tailChunks).toEqual([]);
  // Rejected recovery unlocked it, so remove cleans it up cleanly.
  await afterClearTail!.journal.remove();
  expect(await hasDictationJournalRecord(USER)).toBe(false);
});

it('recovers dictation records oldest-first and retains text-only records with zero WAVs', async () => {
  const newer = beginDictationJournal(USER, makeMeta({ startedAt: 2_000 }))!;
  const older = beginDictationJournal(USER, makeMeta({ startedAt: 1_000 }))!;
  await older.updateState(
    makeMeta({
      startedAt: 1_000,
      elapsedMs: 4_000,
      segments: [
        makeSegment(0, { status: 'completed', text: 'already transcribed', hasWav: false }),
      ],
    })
  );
  await newer.updateState(makeMeta({ startedAt: 2_000, elapsedMs: 1_000 }));
  older.release();
  newer.release();
  await Promise.resolve();

  const seen: string[] = [];
  await recoverDictationJournal(USER, (entry) => {
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

it('sign-out removes both voice and dictation records for that account only', async () => {
  const activeVoice = beginVoice();
  const activeDictation = beginDictationJournal(USER, makeMeta())!;
  const otherVoice = beginVoice(OTHER);
  const otherDictation = beginDictationJournal(OTHER, makeMeta())!;

  const writingVoice = activeVoice.append(0, new Blob(['active']), 1_000);
  const writingDictation = activeDictation.appendTail(0, pcmFrames(2, 9), 200, 0, 2);
  await otherVoice.append(0, new Blob(['other']), 1_000);
  await otherDictation.appendTail(0, pcmFrames(2, 7), 200, 0, 2);

  const clearing = clearCaptureJournal(USER);
  await Promise.all([writingVoice, writingDictation, clearing]);
  releaseVoiceRecording(activeVoice.id);
  activeDictation.release();
  releaseVoiceRecording(otherVoice.id);
  otherDictation.release();
  await Promise.resolve();

  expect(await hasDictationJournalRecord(USER)).toBe(false);
  expect(await hasDictationJournalRecord(OTHER)).toBe(true);

  const voiceOffer = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, voiceOffer);
  expect(voiceOffer).not.toHaveBeenCalled();
  await recoverVoiceRecording(OTHER, undefined, voiceOffer);
  expect(voiceOffer).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ recordingId: otherVoice.id })
  );
});

it('keeps a chunk still being written when the lock is given up', async () => {
  const recording = beginVoice();
  const written = recording.append(0, new Blob(['queued']), 1_000);
  releaseVoiceRecording(recording.id);
  await written;
  const offer = vi.fn((_draft: { file: File }) => true);
  await recoverVoiceRecording(USER, undefined, offer);
  expect(await offer.mock.calls[0]![0].file.text()).toBe('queued');
});

it('does not journal on browsers without Web Locks', async () => {
  vi.stubGlobal('navigator', {});
  expect(beginVoiceRecording(USER, Date.now(), 'audio/ogg')).toBeUndefined();
  expect(beginDictationJournal(USER, makeMeta())).toBeUndefined();
  expect(await hasDictationJournalRecord(USER)).toBe(false);
});
