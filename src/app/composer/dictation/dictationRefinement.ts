import {
  buildPcm16WavHeader,
  DICTATION_FRAME_SAMPLES,
  DICTATION_MAX_SEGMENT_BYTES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
  type DictationSegment,
} from './dictationSegmenter';
import { stitchTranscript, type StitchSegmentInput } from './stitchTranscript';

export const REFINEMENT_MAX_GROUP_SECONDS = 16;
export const REFINEMENT_MAX_GROUP_SEGMENTS = 4;
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
export type DictationSegmentMeta = Omit<DictationSegment, 'wav'>;
export type RefinementGroup = {
  startIndex: number;
  endIndex: number;
  state: 'open' | 'queued' | 'uploading' | 'refined' | 'fallback';
  mergedWav?: Blob;
  mergedSeconds?: number;
  refinedText?: string;
  refinedEndIndex?: number;
  liveFailedEndIndex?: number;
  uploadingEndIndex?: number;
};
export type StitchableSegmentRecord = {
  segment: Pick<DictationSegmentMeta, 'overlapped'>;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  text?: string;
};
export type RefinementSegmentRecord = StitchableSegmentRecord & {
  segment: DictationSegmentMeta;
  wav?: Blob;
};
export type NextUploadTask =
  | { kind: 'refinement'; group: RefinementGroup; endIndex: number }
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
  if (segments.length < 2 || segments.length > REFINEMENT_MAX_GROUP_SEGMENTS) return null;
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

const groupCoveredEnd = (group: RefinementGroup): number => {
  if (!group.refinedText) return group.startIndex - 1;
  const end = group.refinedEndIndex ?? (group.state === 'refined' ? group.endIndex : undefined);
  return end !== undefined ? Math.min(end, group.endIndex) : group.startIndex - 1;
};

const groupNeedsLiveRefinement = (group: RefinementGroup): boolean =>
  group.state === 'open' &&
  group.uploadingEndIndex === undefined &&
  group.endIndex > group.startIndex &&
  groupCoveredEnd(group) < group.endIndex &&
  (group.liveFailedEndIndex ?? -1) < group.endIndex;

const sliceSegments = (
  records: readonly RefinementSegmentRecord[],
  start: number,
  end: number
): SliceableSegment[] | null => {
  const out: SliceableSegment[] = [];
  for (let i = start; i <= end; i += 1) {
    const rec = records[i];
    if (!rec || !rec.wav) return null;
    out.push({ ...rec.segment, wav: rec.wav });
  }
  return out;
};

/** Builds a merged WAV for `records[startIndex..endIndex]`, or returns null if unmergeable. */
export const buildGroupMergedWav = (
  records: readonly RefinementSegmentRecord[],
  startIndex: number,
  endIndex: number
): { wav: Blob; seconds: number } | null => {
  const segments = sliceSegments(records, startIndex, endIndex);
  return segments ? buildMergedGroupWav(segments) : null;
};

/** Releases WAV blobs for locked segments while retaining uncovered queued/uploading/failed WAVs. */
export const releaseGroupWavs = (
  group: RefinementGroup,
  records: readonly Pick<RefinementSegmentRecord, 'wav' | 'status'>[]
): void => {
  if (group.state !== 'refined' && group.state !== 'fallback') return;
  const coveredEnd = groupCoveredEnd(group);
  for (let i = group.startIndex; i <= group.endIndex; i += 1) {
    const record = records[i];
    if (!record) continue;
    if (group.state === 'refined' || record.status === 'completed' || i <= coveredEnd) {
      record.wav = undefined;
    }
  }
};

/** Seals an open refinement group into uploading, refined, queued (merged WAV), or fallback. */
export const sealRefinementGroup = (
  group: RefinementGroup,
  records: readonly RefinementSegmentRecord[]
): boolean => {
  if (group.state !== 'open') return false;
  if (group.uploadingEndIndex !== undefined) {
    group.state = 'uploading';
    return true;
  }
  if (group.refinedEndIndex === group.endIndex && group.refinedText) {
    group.mergedWav = undefined;
    group.mergedSeconds = undefined;
    group.state = 'refined';
    releaseGroupWavs(group, records);
    return true;
  }
  const merged = buildGroupMergedWav(records, group.startIndex, group.endIndex);
  if (!merged) {
    group.state = 'fallback';
    releaseGroupWavs(group, records);
    return true;
  }
  group.mergedWav = merged.wav;
  group.mergedSeconds = merged.seconds;
  group.state = 'queued';
  return true;
};

/** Appends the newest record (at `records.length - 1`) into `groups`, sealing on cap or cut bounds. */
export const appendSegmentToGroups = (
  groups: RefinementGroup[],
  records: readonly RefinementSegmentRecord[]
): void => {
  const idx = records.length - 1;
  const record = records[idx];
  if (!record) return;

  const last = groups[groups.length - 1];
  const open = last?.state === 'open' ? last : undefined;
  let appended = false;

  if (
    open !== undefined &&
    !record.segment.overlapped &&
    records[open.endIndex]?.segment.cutReason !== 'hard' &&
    idx - open.startIndex + 1 <= REFINEMENT_MAX_GROUP_SEGMENTS
  ) {
    const candidate = sliceSegments(records, open.startIndex, idx);
    if (candidate && estimateMergedGroupSeconds(candidate) <= REFINEMENT_MAX_GROUP_SECONDS) {
      open.endIndex = idx;
      appended = true;
    }
  }

  if (!appended) {
    if (open) sealRefinementGroup(open, records);
    groups.push({ startIndex: idx, endIndex: idx, state: 'open' });
  }

  if (record.segment.cutReason === 'hard') {
    const current = groups[groups.length - 1];
    if (current) sealRefinementGroup(current, records);
  }
};

/** Returns true when primary record `index` is covered by a refined transcript range. */
export const isRecordCoveredByRefinement = (
  groups: readonly RefinementGroup[],
  index: number
): boolean => groups.some((group) => index >= group.startIndex && index <= groupCoveredEnd(group));

/** Picks the chronologically earliest queued/live refinement or uncovered primary upload. */
export const selectNextUpload = (
  records: readonly Pick<StitchableSegmentRecord, 'status'>[],
  groups: readonly RefinementGroup[],
  deferOpenPrimaries = false
): NextUploadTask | null => {
  for (const group of groups) {
    if (
      group.state === 'refined' ||
      group.state === 'uploading' ||
      group.uploadingEndIndex !== undefined ||
      (deferOpenPrimaries && group.state === 'open')
    ) {
      continue;
    }
    if (group.state === 'queued' || groupNeedsLiveRefinement(group)) {
      return { kind: 'refinement', group, endIndex: group.endIndex };
    }
    const firstUncovered = Math.max(group.startIndex, groupCoveredEnd(group) + 1);
    for (let i = firstUncovered; i <= group.endIndex; i += 1) {
      if (records[i]?.status === 'queued') return { kind: 'primary', index: i };
    }
  }
  return null;
};

/** Stitches completed primaries and refined ranges up to `limit`, replacing covered ranges atomically. */
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
    const end = Math.min(group.endIndex, capped - 1);
    let primaryStart = group.startIndex;
    const coveredEnd = groupCoveredEnd(group);
    if (group.refinedText && coveredEnd >= group.startIndex && coveredEnd < capped) {
      parts.push({
        text: group.refinedText,
        overlapped: records[group.startIndex]?.segment.overlapped ?? false,
      });
      primaryStart = coveredEnd + 1;
    }
    for (let i = primaryStart; i <= end; i += 1) {
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
    const coveredEnd = groupCoveredEnd(group);
    completedSegments += Math.max(0, coveredEnd - group.startIndex + 1);

    const refining =
      group.state === 'queued' ||
      group.state === 'uploading' ||
      (group.state === 'open' &&
        (group.uploadingEndIndex !== undefined || groupNeedsLiveRefinement(group)));
    if (refining) pendingUploads += 1;

    for (let i = Math.max(group.startIndex, coveredEnd + 1); i <= group.endIndex; i += 1) {
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
