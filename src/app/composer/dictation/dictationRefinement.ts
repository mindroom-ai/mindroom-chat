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
export type UploadHistoryEntry = { atMs: number; seconds: number };
export type RefinementGroup = {
  startIndex: number;
  endIndex: number;
  overlapped: boolean;
  state: 'open' | 'queued' | 'uploading' | 'refined' | 'fallback' | 'skipped';
  mergedWav?: Blob;
  mergedSeconds?: number;
  refinedText?: string;
};
export type StitchableSegmentRecord = {
  segment: Pick<DictationSegment, 'overlapped'>;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  text?: string;
};

type SliceableSegment = Pick<
  DictationSegment,
  'wav' | 'leadingQuietFrames' | 'trailingQuietFrames' | 'overlapped'
>;
type SplittableSegment = SliceableSegment & Pick<DictationSegment, 'pauseBeforeMs'>;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

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
  let hasEmpty = false;
  const padAfter: number[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    const s = slices[i];
    if (!s) continue;
    const count = s.endFrame - s.startFrame;
    if (count <= 0) hasEmpty = true;
    totalFrames += count;
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
    hasEmpty,
  };
};

/** Returns exact packed duration in seconds using the same slice + pad math as buildMergedGroupWav. */
export const estimateMergedGroupSeconds = (segments: readonly SliceableSegment[]): number =>
  planMergedGroup(segments).seconds;

/** Builds a merged 16 kHz mono PCM16 WAV from 2+ segments with capped 288 ms internal gaps. */
export const buildMergedGroupWav = (
  segments: readonly SliceableSegment[]
): { wav: Blob; seconds: number } | null => {
  if (segments.length < 2) return null;
  const plan = planMergedGroup(segments);
  if (
    plan.hasEmpty ||
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
export const pruneUploadHistory = (history: UploadHistoryEntry[], nowMs: number): void => {
  const cutoff = nowMs - REFINEMENT_RATE_WINDOW_MS;
  let write = 0;
  for (const entry of history) {
    if (entry.atMs >= cutoff) history[write++] = entry;
  }
  history.length = write;
};

/** Returns true when an optional refinement fits inside the rolling RPM and audio-seconds caps. */
export const canAffordRefinement = (
  history: UploadHistoryEntry[],
  nowMs: number,
  audioSeconds: number
): boolean => {
  pruneUploadHistory(history, nowMs);
  if (history.length >= REFINEMENT_MAX_REQUESTS_PER_MINUTE) return false;
  const usedSeconds = history.reduce((sum, entry) => sum + entry.seconds, 0);
  return usedSeconds + audioSeconds <= REFINEMENT_MAX_AUDIO_SECONDS_PER_MINUTE;
};

/** Seals an open refinement group into skipped (1 segment), queued (merged WAV), or fallback. */
export const sealRefinementGroup = (
  group: RefinementGroup,
  segments: readonly DictationSegment[]
): void => {
  if (group.state !== 'open') return;
  if (group.endIndex - group.startIndex + 1 < 2) {
    group.state = 'skipped';
    return;
  }
  const merged = buildMergedGroupWav(segments.slice(group.startIndex, group.endIndex + 1));
  if (!merged) {
    group.state = 'fallback';
    return;
  }
  group.mergedWav = merged.wav;
  group.mergedSeconds = merged.seconds;
  group.state = 'queued';
};

/** Appends the newest segment (at `segments.length - 1`) into `groups`, splitting/sealing as needed. */
export const appendSegmentToGroups = (
  groups: RefinementGroup[],
  segments: readonly DictationSegment[]
): void => {
  const idx = segments.length - 1;
  const segment = segments[idx];
  if (!segment) return;

  const last = groups[groups.length - 1];
  const open = last?.state === 'open' ? last : undefined;
  const canAppend =
    open !== undefined && !segment.overlapped && segments[open.endIndex]?.cutReason !== 'hard';

  if (canAppend) {
    const openSegs = segments.slice(open.startIndex, open.endIndex + 1);
    if (estimateMergedGroupSeconds([...openSegs, segment]) <= REFINEMENT_MAX_GROUP_SECONDS) {
      open.endIndex = idx;
    } else {
      const newStart = open.startIndex + chooseGroupSplitIndex(openSegs, segment);
      open.endIndex = newStart - 1;
      sealRefinementGroup(open, segments);
      groups.push({
        startIndex: newStart,
        endIndex: idx,
        overlapped: segments[newStart]?.overlapped ?? segment.overlapped,
        state: 'open',
      });
    }
  } else {
    if (open) sealRefinementGroup(open, segments);
    groups.push({ startIndex: idx, endIndex: idx, overlapped: segment.overlapped, state: 'open' });
  }

  if (segment.cutReason === 'hard') {
    const current = groups[groups.length - 1];
    if (current) sealRefinementGroup(current, segments);
  }
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
      parts.push({ text: group.refinedText, overlapped: group.overlapped });
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
