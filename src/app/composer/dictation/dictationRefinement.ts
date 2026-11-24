import {
  buildPcm16WavHeader,
  DICTATION_FRAME_SAMPLES,
  DICTATION_MAX_SEGMENT_BYTES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
  type DictationSegment,
} from './dictationSegmenter';
import { stitchTranscript, type StitchSegmentInput } from './stitchTranscript';

export const REFINEMENT_MAX_GROUP_SECONDS = 22;
export const REFINEMENT_MIN_SPLIT_PREFIX_SECONDS = 10;
export const REFINEMENT_INTERNAL_TRAILING_QUIET_FRAMES = 1;
export const REFINEMENT_INTERNAL_LEADING_QUIET_FRAMES = 2;
export const REFINEMENT_MAX_OUTER_LEADING_QUIET_FRAMES = 3;
export const REFINEMENT_MAX_OUTER_TRAILING_QUIET_FRAMES = 2;
export const REFINEMENT_MAX_REQUESTS_PER_MINUTE = 24;
export const REFINEMENT_MAX_AUDIO_SECONDS_PER_MINUTE = 150;
export const REFINEMENT_RATE_WINDOW_MS = 60_000;

const FRAME_BYTES = DICTATION_FRAME_SAMPLES * 2;
const MIN_INTERNAL_GAP_FRAMES =
  REFINEMENT_INTERNAL_TRAILING_QUIET_FRAMES + REFINEMENT_INTERNAL_LEADING_QUIET_FRAMES;

export type SegmentSlicePosition = 'first' | 'middle' | 'last' | 'only';
export type SegmentSliceFrames = {
  startFrame: number;
  endFrame: number;
  keptLeading: number;
  keptTrailing: number;
};
export type DictationUploadSample = { atMs: number; seconds: number };
export type DictationRateBudget = {
  uploadHistory: DictationUploadSample[];
  retryNotBeforeMs: number;
};
export type RefinementGroup = {
  startIndex: number;
  endIndex: number;
  state: 'open' | 'queued' | 'uploading' | 'refined' | 'fallback';
  mergedWav?: Blob;
  mergedSeconds?: number;
  refinedText?: string;
};
export type StitchableSegmentRecord = {
  segment: Pick<DictationSegment, 'overlapped'>;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  text?: string;
};
export type NextUploadTask =
  | { kind: 'refinement'; group: RefinementGroup }
  | { kind: 'primary'; index: number };
export type SessionRecordSummary = {
  pendingUploads: number;
  failedSegments: number;
  completedSegments: number;
  hasPartialText: boolean;
  previewText: string;
};

type SliceableSegment = Pick<
  DictationSegment,
  'wav' | 'leadingQuietFrames' | 'trailingQuietFrames' | 'overlapped'
>;
type SplittableSegment = SliceableSegment & Pick<DictationSegment, 'pauseBeforeMs'>;
type SegmentCarrier = { segment: DictationSegment };

/** Creates a shared rolling rate-limit budget and Retry-After cooldown tracker. */
export const createDictationRateBudget = (): DictationRateBudget => ({
  uploadHistory: [],
  retryNotBeforeMs: 0,
});

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const isFrameAlignedWav = (wav: Blob): boolean => {
  const dataBytes = wav.size - DICTATION_WAV_HEADER_BYTES;
  return dataBytes > 0 && dataBytes % FRAME_BYTES === 0;
};

/** Computes the [startFrame, endFrame) slice kept for a segment without trimming voiced frames. */
export const computeSegmentSliceFrames = (
  segment: SliceableSegment,
  position: SegmentSlicePosition
): SegmentSliceFrames => {
  const totalFrames = Math.floor(
    Math.max(0, segment.wav.size - DICTATION_WAV_HEADER_BYTES) / FRAME_BYTES
  );
  if (totalFrames <= 0) return { startFrame: 0, endFrame: 0, keptLeading: 0, keptTrailing: 0 };

  const firstVoiced = clamp(Math.floor(segment.leadingQuietFrames), 0, totalFrames - 1);
  const lastVoiced = clamp(
    totalFrames - 1 - Math.floor(segment.trailingQuietFrames),
    firstVoiced,
    totalFrames - 1
  );
  const trailingAvail = totalFrames - 1 - lastVoiced;
  const keptLeading =
    position === 'first' || position === 'only'
      ? segment.overlapped
        ? firstVoiced
        : Math.min(firstVoiced, REFINEMENT_MAX_OUTER_LEADING_QUIET_FRAMES)
      : Math.min(firstVoiced, REFINEMENT_INTERNAL_LEADING_QUIET_FRAMES);
  const keptTrailing =
    position === 'last' || position === 'only'
      ? Math.min(trailingAvail, REFINEMENT_MAX_OUTER_TRAILING_QUIET_FRAMES)
      : Math.min(trailingAvail, REFINEMENT_INTERNAL_TRAILING_QUIET_FRAMES);

  return {
    startFrame: firstVoiced - keptLeading,
    endFrame: lastVoiced + 1 + keptTrailing,
    keptLeading,
    keptTrailing,
  };
};

const planMergedGroup = (segments: readonly SliceableSegment[]) => {
  if (segments.length === 0) return { slices: [], padAfter: [], dataBytes: 0, seconds: 0 };
  for (const seg of segments) {
    if (!isFrameAlignedWav(seg.wav)) return null;
  }
  const slices = segments.map((seg, i) =>
    computeSegmentSliceFrames(
      seg,
      segments.length === 1
        ? 'only'
        : i === 0
        ? 'first'
        : i === segments.length - 1
        ? 'last'
        : 'middle'
    )
  );
  let totalFrames = 0;
  const padAfter: number[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    const s = slices[i];
    if (!s) continue;
    totalFrames += s.endFrame - s.startFrame;
    if (i < slices.length - 1) {
      const next = slices[i + 1];
      const pad = Math.max(
        0,
        MIN_INTERNAL_GAP_FRAMES - (s.keptTrailing + (next?.keptLeading ?? 0))
      );
      padAfter.push(pad);
      totalFrames += pad;
    }
  }
  return {
    slices,
    padAfter,
    dataBytes: totalFrames * FRAME_BYTES,
    seconds: (totalFrames * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
  };
};

/** Returns exact packed duration in seconds using the same slice + pad math as buildMergedGroupWav. */
export const estimateMergedGroupSeconds = (segments: readonly SliceableSegment[]): number =>
  planMergedGroup(segments)?.seconds ?? Infinity;

/** Builds a merged 16 kHz mono PCM16 WAV from 2+ frame-aligned segments with capped 288 ms gaps. */
export const buildMergedGroupWav = (
  segments: readonly SliceableSegment[]
): { wav: Blob; seconds: number } | null => {
  if (segments.length < 2) return null;
  const plan = planMergedGroup(segments);
  if (
    !plan ||
    plan.dataBytes <= 0 ||
    plan.seconds > REFINEMENT_MAX_GROUP_SECONDS ||
    DICTATION_WAV_HEADER_BYTES + plan.dataBytes > DICTATION_MAX_SEGMENT_BYTES
  ) {
    return null;
  }

  const parts: BlobPart[] = [buildPcm16WavHeader(plan.dataBytes, DICTATION_SAMPLE_RATE)];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const slice = plan.slices[i];
    if (!seg || !slice) return null;
    parts.push(
      seg.wav.slice(
        DICTATION_WAV_HEADER_BYTES + slice.startFrame * FRAME_BYTES,
        DICTATION_WAV_HEADER_BYTES + slice.endFrame * FRAME_BYTES
      )
    );
    const pad = plan.padAfter[i] ?? 0;
    if (pad > 0) parts.push(new Uint8Array(pad * FRAME_BYTES));
  }
  return { wav: new Blob(parts, { type: 'audio/wav' }), seconds: plan.seconds };
};

/** Selects the split index in 1..openSegments.length with the longest pause after >= 10 s prefix. */
export const chooseGroupSplitIndex = (
  openSegments: readonly SplittableSegment[],
  nextSegment: SplittableSegment
): number => {
  let bestIdx: number | undefined;
  let bestPause = -1;
  for (let i = 1; i <= openSegments.length; i += 1) {
    if (
      estimateMergedGroupSeconds([...openSegments.slice(i), nextSegment]) >
        REFINEMENT_MAX_GROUP_SECONDS ||
      estimateMergedGroupSeconds(openSegments.slice(0, i)) < REFINEMENT_MIN_SPLIT_PREFIX_SECONDS
    ) {
      continue;
    }
    const raw = (i < openSegments.length ? openSegments[i] : nextSegment)?.pauseBeforeMs ?? 0;
    const pause = Number.isNaN(raw) ? 0 : raw;
    if (bestIdx === undefined || pause >= bestPause) {
      bestPause = pause;
      bestIdx = i;
    }
  }
  return bestIdx ?? openSegments.length;
};

/** Prunes upload history entries older than the rolling 60 s window in place. */
export const pruneUploadHistory = (history: DictationUploadSample[], nowMs: number): void => {
  const cutoff = nowMs - REFINEMENT_RATE_WINDOW_MS;
  let write = 0;
  for (const entry of history) {
    if (entry.atMs >= cutoff) history[write++] = entry;
  }
  history.length = write;
};

/** Records an upload attempt into the rolling 60 s rate budget. */
export const recordDictationUpload = (
  budget: DictationRateBudget,
  nowMs: number,
  seconds: number
): void => {
  pruneUploadHistory(budget.uploadHistory, nowMs);
  budget.uploadHistory.push({ atMs: nowMs, seconds });
};

/** Returns true when an optional refinement fits inside the rolling RPM and audio-seconds caps. */
export const canAffordRefinement = (
  history: DictationUploadSample[],
  nowMs: number,
  audioSeconds: number
): boolean => {
  pruneUploadHistory(history, nowMs);
  if (history.length >= REFINEMENT_MAX_REQUESTS_PER_MINUTE) return false;
  const usedSeconds = history.reduce((sum, entry) => sum + entry.seconds, 0);
  return usedSeconds + audioSeconds <= REFINEMENT_MAX_AUDIO_SECONDS_PER_MINUTE;
};

const sliceSegments = (records: readonly SegmentCarrier[], start: number, end: number) => {
  const out: DictationSegment[] = [];
  for (let i = start; i <= end; i += 1) {
    const rec = records[i];
    if (rec) out.push(rec.segment);
  }
  return out;
};

/** Seals an open refinement group into queued (merged WAV) or fallback (1 segment / unmergeable). */
export const sealRefinementGroup = (
  group: RefinementGroup,
  records: readonly SegmentCarrier[]
): boolean => {
  if (group.state !== 'open') return false;
  if (group.endIndex - group.startIndex + 1 < 2) {
    group.state = 'fallback';
    return true;
  }
  const merged = buildMergedGroupWav(sliceSegments(records, group.startIndex, group.endIndex));
  if (!merged) {
    group.state = 'fallback';
    return true;
  }
  group.mergedWav = merged.wav;
  group.mergedSeconds = merged.seconds;
  group.state = 'queued';
  return true;
};

/** Appends the newest record (at `records.length - 1`) into `groups`, splitting/sealing as needed. */
export const appendSegmentToGroups = (
  groups: RefinementGroup[],
  records: readonly SegmentCarrier[]
): void => {
  const idx = records.length - 1;
  const segment = records[idx]?.segment;
  if (!segment) return;

  const last = groups[groups.length - 1];
  const open = last?.state === 'open' ? last : undefined;
  const canAppend =
    open !== undefined &&
    !segment.overlapped &&
    records[open.endIndex]?.segment.cutReason !== 'hard';

  if (canAppend) {
    const openSegs = sliceSegments(records, open.startIndex, open.endIndex);
    if (estimateMergedGroupSeconds([...openSegs, segment]) <= REFINEMENT_MAX_GROUP_SECONDS) {
      open.endIndex = idx;
    } else {
      const newStart = open.startIndex + chooseGroupSplitIndex(openSegs, segment);
      open.endIndex = newStart - 1;
      sealRefinementGroup(open, records);
      groups.push({ startIndex: newStart, endIndex: idx, state: 'open' });
    }
  } else {
    if (open) sealRefinementGroup(open, records);
    groups.push({ startIndex: idx, endIndex: idx, state: 'open' });
  }

  if (segment.cutReason === 'hard') {
    const current = groups[groups.length - 1];
    if (current) sealRefinementGroup(current, records);
  }
};

/** Returns true when primary record `index` is covered by a completed refinement group. */
export const isRecordCoveredByRefinement = (
  groups: readonly RefinementGroup[],
  index: number
): boolean =>
  groups.some(
    (group) => group.state === 'refined' && index >= group.startIndex && index <= group.endIndex
  );

/** Picks the chronologically earliest queued refinement or uncovered primary upload. */
export const selectNextUpload = (
  records: readonly Pick<StitchableSegmentRecord, 'status'>[],
  groups: readonly RefinementGroup[],
  deferOpenPrimaries = false
): NextUploadTask | null => {
  const nextGroup = groups.find((group) => group.state === 'queued');
  let nextPrimaryIndex = -1;

  for (const group of groups) {
    if (group.state === 'queued' || group.state === 'uploading' || group.state === 'refined') {
      continue;
    }
    if (deferOpenPrimaries && group.state === 'open') continue;
    for (let i = group.startIndex; i <= group.endIndex; i += 1) {
      if (records[i]?.status === 'queued') {
        nextPrimaryIndex = i;
        break;
      }
    }
    if (nextPrimaryIndex !== -1) break;
  }

  if (nextGroup && (nextPrimaryIndex === -1 || nextGroup.startIndex <= nextPrimaryIndex)) {
    return { kind: 'refinement', group: nextGroup };
  }
  return nextPrimaryIndex !== -1 ? { kind: 'primary', index: nextPrimaryIndex } : null;
};

/** Stitches completed primaries and refined groups up to `limit`, replacing refined ranges atomically. */
export const stitchRefinedSegments = (
  records: readonly StitchableSegmentRecord[],
  groups: readonly RefinementGroup[],
  limit = records.length
): string => {
  const capped = Math.min(Math.max(0, limit), records.length);
  if (capped === 0) return '';

  const parts: StitchSegmentInput[] = [];
  for (const group of groups) {
    if (group.startIndex >= capped) break;
    if (group.state === 'refined' && group.refinedText && group.endIndex < capped) {
      parts.push({
        text: group.refinedText,
        overlapped: records[group.startIndex]?.segment.overlapped ?? false,
      });
      continue;
    }
    const end = Math.min(group.endIndex, capped - 1);
    for (let i = group.startIndex; i <= end; i += 1) {
      const record = records[i];
      if (record?.status === 'completed' && record.text !== undefined) {
        parts.push({ text: record.text, overlapped: record.segment.overlapped });
      }
    }
  }
  return stitchTranscript(parts);
};

/** Summarizes upload counters and stitched live preview across primary records and refinement groups. */
export const summarizeSessionRecords = (
  records: readonly StitchableSegmentRecord[],
  groups: readonly RefinementGroup[]
): SessionRecordSummary => {
  let pendingUploads = 0;
  let failedSegments = 0;
  let completedSegments = 0;

  for (const group of groups) {
    if (group.state === 'refined') {
      completedSegments += group.endIndex - group.startIndex + 1;
      continue;
    }
    const refining = group.state === 'queued' || group.state === 'uploading';
    if (refining) pendingUploads += 1;
    for (let i = group.startIndex; i <= group.endIndex; i += 1) {
      const record = records[i];
      if (!record) continue;
      if (record.status === 'uploading' || (!refining && record.status === 'queued')) {
        pendingUploads += 1;
      } else if (record.status === 'failed') failedSegments += 1;
      else if (record.status === 'completed') completedSegments += 1;
    }
  }

  const previewText = stitchRefinedSegments(records, groups);
  return {
    pendingUploads,
    failedSegments,
    completedSegments,
    hasPartialText: previewText.length > 0,
    previewText,
  };
};
