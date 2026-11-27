import type {
  DictationJournalHandle,
  DictationJournalMeta,
  DictationTailChunk,
} from '../capture/captureJournal';
import {
  appendSegmentToGroups,
  sealRefinementGroup,
  summarizeSessionRecords,
  type DictationSegmentMeta,
  type RefinementGroup,
  type RefinementSegmentRecord,
} from './dictationRefinement';
import {
  computeFrameRms,
  decodePcm16Frames,
  DICTATION_FRAME_MS,
  DICTATION_FRAME_SAMPLES,
  DICTATION_HARD_CUT_FRAMES,
  DICTATION_HARD_CUT_OVERLAP_FRAMES,
  DICTATION_MAX_ACTIVE_FRAMES,
  DICTATION_MAX_SEGMENT_BYTES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
  DictationSegmenter,
  encodePcm16Frames,
  encodePcm16WavBuffer,
  SILENCE_RMS_FLOOR,
  type DictationSegment,
} from './dictationSegmenter';
import { loadSileroVad, type SileroVadInstance } from './sileroVad';

/** Flush delta PCM tail chunks roughly once per second (~10 * 96 ms = 960 ms). */
const TAIL_CHECKPOINT_FRAMES = 10;
/** Upper bound on waiting for Silero VAD during reload recovery before falling back to raw WAVs. */
const RECOVERY_VAD_TIMEOUT_MS = 8_000;
const MAX_FALLBACK_PCM_SAMPLES = Math.floor(
  (DICTATION_MAX_SEGMENT_BYTES - DICTATION_WAV_HEADER_BYTES) / 2
);

export type RecoveredDictationRecord = {
  segment: DictationSegmentMeta;
  wav?: Blob;
  status: 'queued' | 'completed' | 'failed';
  text?: string;
  error?: string;
  retryable: boolean;
};

export type RecoveredDictationState = {
  startedAt: number;
  elapsedMs: number;
  capReached: boolean;
  originApiUrl?: string;
  originRoomId?: string;
  records: RecoveredDictationRecord[];
  groups: RefinementGroup[];
  initialSegmentIndex: number;
  initialActiveFrames: number;
};

export type SerializableDictationState = {
  startedAt: number;
  elapsedMs: number;
  capReached: boolean;
  consumedThroughFramePos?: number;
  originApiUrl?: string;
  originRoomId?: string;
  records: readonly (Pick<RefinementSegmentRecord, 'segment' | 'status' | 'text'> & {
    error?: string;
    retryable: boolean;
  })[];
  groups: readonly RefinementGroup[];
};

export type DictationCheckpointer = {
  checkpointState: (clearAllTail?: boolean) => Promise<void>;
  pushTailFrame: (frame: Float32Array, pos: number) => void;
  flushTailBuffer: () => void;
  commitSegment: (segment: DictationSegment) => void;
  clearTailState: () => void;
  resetTailState: () => void;
  getJournalId: () => string | undefined;
  takeJournal: () => DictationJournalHandle | undefined;
};

export type ReplayDictationTailOptions = {
  tailChunks: readonly DictationTailChunk[];
  consumedThroughFramePos?: number;
  baseElapsedMs: number;
  initialSegmentIndex: number;
  initialOverlapped: boolean;
  loadVad?: (signal?: AbortSignal) => Promise<SileroVadInstance>;
};

export type PreparedDictationRecovery = {
  records: RecoveredDictationRecord[];
  groups: RefinementGroup[];
  tailSegments: DictationSegment[];
  effectiveElapsedMs: number;
  initialSegmentIndex: number;
  initialActiveFrames: number;
  capReached: boolean;
  isEmpty: boolean;
};

export const serializeDictationMeta = (
  state: SerializableDictationState
): DictationJournalMeta => ({
  startedAt: state.startedAt,
  elapsedMs: state.elapsedMs,
  capReached: state.capReached,
  ...(state.consumedThroughFramePos !== undefined
    ? { consumedThroughFramePos: state.consumedThroughFramePos }
    : {}),
  ...(state.originApiUrl !== undefined ? { originApiUrl: state.originApiUrl } : {}),
  ...(state.originRoomId !== undefined ? { originRoomId: state.originRoomId } : {}),
  segments: state.records.map((record) => ({
    ...record.segment,
    status: record.status === 'uploading' ? 'queued' : record.status,
    ...(record.text !== undefined ? { text: record.text } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    retryable: record.retryable,
  })),
  groups: state.groups.map((group) => ({
    startIndex: group.startIndex,
    endIndex: group.endIndex,
    state: group.state === 'uploading' ? 'queued' : group.state,
    ...(group.refinedText !== undefined ? { refinedText: group.refinedText } : {}),
    ...(group.refinedEndIndex !== undefined ? { refinedEndIndex: group.refinedEndIndex } : {}),
  })),
});

export const hydrateDictationRecords = (
  meta: DictationJournalMeta,
  wavs: ReadonlyMap<number, ArrayBuffer>
): { records: RecoveredDictationRecord[]; groups: RefinementGroup[] } => ({
  records: [...meta.segments]
    .sort((a, b) => a.index - b.index)
    .map((persisted) => {
      const wavBytes = wavs.get(persisted.index);
      return {
        segment: {
          index: persisted.index,
          seconds: persisted.seconds,
          overlapped: persisted.overlapped,
          cutReason: persisted.cutReason,
          leadingQuietFrames: persisted.leadingQuietFrames,
          trailingQuietFrames: persisted.trailingQuietFrames,
          pauseBeforeMs:
            typeof persisted.pauseBeforeMs === 'number' ? persisted.pauseBeforeMs : Infinity,
        },
        wav: wavBytes ? new Blob([wavBytes], { type: 'audio/wav' }) : undefined,
        status: persisted.status,
        text: persisted.text,
        error: persisted.error,
        retryable: persisted.retryable,
      };
    }),
  groups: meta.groups.map((group) => ({ ...group })),
});

/** Manages live journal checkpoints and periodic delta PCM tail buffering. */
export const createDictationCheckpointer = (
  initialJournal: DictationJournalHandle | undefined,
  readState: () => Omit<SerializableDictationState, 'consumedThroughFramePos'>
): DictationCheckpointer => {
  let journal = initialJournal;
  let tailFrames: Float32Array[] = [];
  let tailStartPos: number | undefined;
  let tailEndPos = 0;
  let tailSeq = 0;
  let lastConsumedFramePos: number | undefined;

  const buildJournalMeta = (): DictationJournalMeta =>
    serializeDictationMeta({ ...readState(), consumedThroughFramePos: lastConsumedFramePos });

  const checkpointState = (clearAllTail?: boolean): Promise<void> => {
    if (!journal) return Promise.resolve();
    return journal.updateState(buildJournalMeta(), undefined, clearAllTail).catch(() => undefined);
  };

  const flushTailBuffer = () => {
    if (!journal || tailFrames.length === 0 || tailStartPos === undefined) return;
    const framesToWrite = tailFrames;
    const startPos = tailStartPos;
    const endPos = tailEndPos;
    tailFrames = [];
    tailStartPos = undefined;
    const seq = tailSeq;
    tailSeq += 1;
    void journal
      .appendTail(seq, encodePcm16Frames(framesToWrite), readState().elapsedMs, startPos, endPos)
      .catch(() => undefined);
  };

  const pruneTailBufferThrough = (consumedThroughPos: number | undefined) => {
    if (consumedThroughPos === undefined || tailFrames.length === 0 || tailStartPos === undefined) {
      return;
    }
    if (tailEndPos <= consumedThroughPos) {
      tailFrames = [];
      tailStartPos = undefined;
    } else if (tailStartPos < consumedThroughPos) {
      tailFrames = tailFrames.slice(consumedThroughPos - tailStartPos);
      tailStartPos = consumedThroughPos;
    }
  };

  return {
    checkpointState,
    pushTailFrame: (frame, pos) => {
      if (!journal) return;
      if (tailFrames.length === 0) tailStartPos = pos;
      tailFrames.push(frame);
      tailEndPos = pos + 1;
      if (tailFrames.length >= TAIL_CHECKPOINT_FRAMES) flushTailBuffer();
    },
    flushTailBuffer,
    commitSegment: (segment) => {
      pruneTailBufferThrough(segment.consumedThroughFramePos);
      if (segment.consumedThroughFramePos !== undefined) {
        lastConsumedFramePos = segment.consumedThroughFramePos;
      }
      if (!journal || !segment.wavBuffer) return;
      const journalMeta = buildJournalMeta();
      void journal
        .commitSegment(segment.index, segment.wavBuffer, journalMeta)
        .catch(() => undefined);
      if (segment.cutReason === 'hard' && tailFrames.length > 0) flushTailBuffer();
    },
    clearTailState: () => {
      tailFrames = [];
      tailStartPos = undefined;
      lastConsumedFramePos = undefined;
    },
    resetTailState: () => {
      tailFrames = [];
      tailStartPos = undefined;
      tailEndPos = 0;
      tailSeq = 0;
      lastConsumedFramePos = undefined;
    },
    getJournalId: () => journal?.id,
    takeJournal: () => {
      const current = journal;
      journal = undefined;
      return current;
    },
  };
};

/**
 * Emits bounded WAV segment(s) when RMS fallback produces 0 segments from non-empty PCM frames
 * containing any frame above `SILENCE_RMS_FLOOR`, preventing quiet speech from being deleted when
 * Silero VAD is unavailable. True digital silence (all frames <= `SILENCE_RMS_FLOOR`) returns [].
 */
const buildBoundedFallbackSegments = (
  frames: readonly Float32Array[],
  initialSegmentIndex: number,
  initialOverlapped: boolean
): DictationSegment[] => {
  const frameRms = frames.map((frame) => computeFrameRms(frame));
  if (!frameRms.some((rms) => rms > SILENCE_RMS_FLOOR)) return [];

  const segments: DictationSegment[] = [];
  let segmentIndex = initialSegmentIndex;
  let lastEmittedVoicedPos: number | null = null;
  let prevWasHardCut = false;

  for (let cursor = 0; cursor < frames.length;) {
    let end = cursor;
    let totalSamples = 0;
    while (end < frames.length && end - cursor < DICTATION_HARD_CUT_FRAMES) {
      const sampleCount = frames[end]?.length ?? 0;
      if (end > cursor && totalSamples + sampleCount > MAX_FALLBACK_PCM_SAMPLES) break;
      totalSamples += sampleCount;
      end += 1;
    }

    const hasMore = end < frames.length;
    let firstAudible = -1;
    let lastAudible = -1;
    for (let i = cursor; i < end; i += 1) {
      if ((frameRms[i] ?? 0) > SILENCE_RMS_FLOOR) {
        if (firstAudible === -1) firstAudible = i - cursor;
        lastAudible = i - cursor;
      }
    }

    if (firstAudible !== -1 && lastAudible !== -1 && totalSamples > 0) {
      const chunkFrames = frames.slice(cursor, end);
      const cutReason = hasMore ? 'hard' : 'flush';
      const wavBuffer = encodePcm16WavBuffer(chunkFrames, DICTATION_SAMPLE_RATE);
      segments.push({
        index: segmentIndex,
        wav: new Blob([wavBuffer], { type: 'audio/wav' }),
        wavBuffer,
        seconds: totalSamples / DICTATION_SAMPLE_RATE,
        overlapped: segments.length === 0 ? initialOverlapped : prevWasHardCut,
        cutReason,
        leadingQuietFrames: firstAudible,
        trailingQuietFrames: chunkFrames.length - 1 - lastAudible,
        pauseBeforeMs:
          lastEmittedVoicedPos === null
            ? Infinity
            : Math.max(0, cursor + firstAudible - lastEmittedVoicedPos - 1) * DICTATION_FRAME_MS,
      });
      segmentIndex += 1;
      lastEmittedVoicedPos = cursor + lastAudible;
      prevWasHardCut = cutReason === 'hard';
    } else {
      prevWasHardCut = false;
    }

    if (!hasMore) break;
    cursor = Math.max(cursor + 1, end - DICTATION_HARD_CUT_OVERLAP_FRAMES);
  }

  return segments;
};

/**
 * Replays persisted PCM tail chunks through `DictationSegmenter`, preferring Silero VAD so quiet
 * speech is segmented accurately and preserving bounded non-silent audio if Silero VAD fails.
 */
export const replayDictationTail = async ({
  tailChunks,
  consumedThroughFramePos,
  baseElapsedMs,
  initialSegmentIndex,
  initialOverlapped,
  loadVad = loadSileroVad,
}: ReplayDictationTailOptions): Promise<{
  segments: DictationSegment[];
  effectiveElapsedMs: number;
}> => {
  const sortedTail = [...tailChunks].sort(
    (a, b) => a.startFramePos - b.startFramePos || a.seq - b.seq
  );
  let effectiveElapsedMs = baseElapsedMs;
  for (const chunk of sortedTail) {
    if (chunk.elapsedMs > effectiveElapsedMs) effectiveElapsedMs = chunk.elapsedMs;
  }

  const replayedFrames: Float32Array[] = [];
  let lastEndPos = consumedThroughFramePos ?? 0;
  for (const chunk of sortedTail) {
    if (chunk.endFramePos > lastEndPos) {
      const frames = decodePcm16Frames(chunk.bytes);
      const skipFrames =
        chunk.startFramePos < lastEndPos
          ? Math.min(frames.length, lastEndPos - chunk.startFramePos)
          : 0;
      for (let i = skipFrames; i < frames.length; i += 1) {
        const frame = frames[i];
        if (frame) replayedFrames.push(frame);
      }
      lastEndPos = Math.max(lastEndPos, chunk.endFramePos);
    }
  }

  if (replayedFrames.length === 0) return { segments: [], effectiveElapsedMs };

  const segments: DictationSegment[] = [];
  const tailSegmenter = new DictationSegmenter({
    initialSegmentIndex,
    initialOverlapped,
    maxActiveFrames: Infinity,
    onSegment: (seg) => segments.push(seg),
  });
  for (const frame of replayedFrames) tailSegmenter.pushFrame(frame);

  let vadFailed = false;
  let vad: SileroVadInstance | undefined;
  const vadAbort = new AbortController();
  const vadTimer = setTimeout(() => vadAbort.abort(), RECOVERY_VAD_TIMEOUT_MS);
  try {
    vad = await loadVad(vadAbort.signal);
    const activeVad = vad;
    await tailSegmenter.attachVad({
      score: async (frame) => {
        try {
          return await activeVad.score(frame);
        } catch (error) {
          vadFailed = true;
          throw error;
        }
      },
    });
    await tailSegmenter.flush();
  } catch {
    vadFailed = true;
  } finally {
    clearTimeout(vadTimer);
    if (vad) await vad.release().catch(() => undefined);
  }

  if (vadFailed) {
    return {
      segments: buildBoundedFallbackSegments(
        replayedFrames,
        initialSegmentIndex,
        initialOverlapped
      ),
      effectiveElapsedMs,
    };
  }

  return { segments, effectiveElapsedMs };
};

/** Hydrates persisted records/groups, replays unconsumed tail PCM chunks, and seals open groups. */
export const prepareRecoveredDictation = async (
  meta: DictationJournalMeta,
  wavs: ReadonlyMap<number, ArrayBuffer>,
  tailChunks: readonly DictationTailChunk[],
  loadVad?: (signal?: AbortSignal) => Promise<SileroVadInstance>
): Promise<PreparedDictationRecovery> => {
  const { records, groups } = hydrateDictationRecords(meta, wavs);
  const { segments: tailSegments, effectiveElapsedMs } = await replayDictationTail({
    tailChunks,
    consumedThroughFramePos: meta.consumedThroughFramePos,
    baseElapsedMs: meta.elapsedMs,
    initialSegmentIndex: records.length,
    initialOverlapped: records.at(-1)?.segment.cutReason === 'hard',
    loadVad,
  });

  for (const seg of tailSegments) {
    const { wav, wavBuffer: _wavBuffer, consumedThroughFramePos: _pos, ...segMeta } = seg;
    records.push({ segment: segMeta, wav, status: 'queued', retryable: true });
    appendSegmentToGroups(groups, records);
  }
  for (const group of groups) {
    if (group.state === 'open') sealRefinementGroup(group, records);
  }

  const summary = summarizeSessionRecords(records, groups);
  const isEmpty = records.length === 0 && summary.previewText.trim().length === 0;
  const elapsedFrames = Math.floor(effectiveElapsedMs / DICTATION_FRAME_MS);
  const segmentFrames = Math.round(
    records.reduce((total, record) => total + record.segment.seconds, 0) *
      (DICTATION_SAMPLE_RATE / DICTATION_FRAME_SAMPLES)
  );
  const initialActiveFrames = elapsedFrames > 0 ? elapsedFrames : segmentFrames;

  return {
    records,
    groups,
    tailSegments,
    effectiveElapsedMs,
    initialSegmentIndex: records.length,
    initialActiveFrames,
    capReached: meta.capReached || initialActiveFrames >= DICTATION_MAX_ACTIVE_FRAMES,
    isEmpty,
  };
};

/**
 * Converts replayed tail PCM chunks into durable segment WAVs and clears old tail rows so a
 * subsequent Resume never collides with pre-crash tail sequence numbers.
 */
export const persistRecoveredTail = (
  journal: DictationJournalHandle,
  state: SerializableDictationState,
  tailSegments: readonly DictationSegment[],
  tailChunkCount: number
): void => {
  if (tailSegments.length === 0 && tailChunkCount === 0) return;
  const recoveredMeta = serializeDictationMeta(state);
  const putSegments = tailSegments
    .filter((seg): seg is DictationSegment & { wavBuffer: ArrayBuffer } => Boolean(seg.wavBuffer))
    .map((seg) => ({ index: seg.index, wav: seg.wavBuffer }));
  void journal
    .updateState(recoveredMeta, undefined, true, putSegments.length > 0 ? putSegments : undefined)
    .catch(() => undefined);
};
