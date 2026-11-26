import {
  analyserRmsToMatrixPoint,
  normalizeMatrixWaveform,
  VOICE_WAVEFORM_BAR_COUNT,
} from '../../lib/audioWaveform';
import {
  computeSegmentSliceFrames,
  getRefinementGroupCoveredEnd,
  MIN_INTERNAL_GAP_FRAMES,
  type RefinementGroup,
  type RefinementSegmentRecord,
  type SegmentSlicePosition,
} from './dictationRefinement';
import {
  buildPcm16WavHeader,
  DICTATION_FRAME_SAMPLES,
  DICTATION_HARD_CUT_OVERLAP_FRAMES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
} from './dictationSegmenter';
import { stitchTranscript, type StitchSegmentInput } from './stitchTranscript';

const FRAME_BYTES = DICTATION_FRAME_SAMPLES * 2;

export type DictationVoiceAudio = {
  file: File;
  duration: number;
  waveform: number[];
  missingAudioPartialText?: string;
};

/** Returns true when a dictation segment WAV contains at least one PCM16 sample after its header. */
export const hasUsableDictationWav = (wav: Blob | undefined): wav is Blob =>
  wav !== undefined && wav.size >= DICTATION_WAV_HEADER_BYTES + 2;

const extractMissingAudioPartialText = (
  records: readonly RefinementSegmentRecord[],
  groups: readonly RefinementGroup[]
): string | undefined => {
  if (records.every((record) => hasUsableDictationWav(record.wav))) return undefined;

  const parts: StitchSegmentInput[] = [];
  if (groups.length === 0) {
    for (const record of records) {
      if (
        !hasUsableDictationWav(record.wav) &&
        record.status === 'completed' &&
        record.text !== undefined
      ) {
        parts.push({ text: record.text, overlapped: record.segment.overlapped });
      }
    }
  } else {
    for (const group of groups) {
      if (group.startIndex >= records.length) break;
      const end = Math.min(group.endIndex, records.length - 1);
      let primaryStart = group.startIndex;
      const coveredEnd = Math.min(getRefinementGroupCoveredEnd(group), end);
      if (group.refinedText && coveredEnd >= group.startIndex) {
        let allCoveredMissingWav = true;
        for (let i = group.startIndex; i <= coveredEnd; i += 1) {
          if (hasUsableDictationWav(records[i]?.wav)) {
            allCoveredMissingWav = false;
            break;
          }
        }
        if (allCoveredMissingWav) {
          parts.push({
            text: group.refinedText,
            overlapped: records[group.startIndex]?.segment.overlapped ?? false,
          });
          primaryStart = coveredEnd + 1;
        }
      }
      for (let i = primaryStart; i <= end; i += 1) {
        const record = records[i];
        if (
          record &&
          !hasUsableDictationWav(record.wav) &&
          record.status === 'completed' &&
          record.text !== undefined
        ) {
          parts.push({ text: record.text, overlapped: record.segment.overlapped });
        }
      }
    }
  }

  const stitched = stitchTranscript(parts);
  return stitched.length > 0 ? stitched : undefined;
};

type PlannedVoiceSlice = {
  wav: Blob;
  byteStart: number;
  byteEnd: number;
  keptLeading: number;
  keptTrailing: number;
  adjacentIntoNext: boolean;
};

const computeWaveformFromPcm16 = (view: DataView, totalSamples: number): number[] => {
  if (totalSamples <= 0) return normalizeMatrixWaveform([], VOICE_WAVEFORM_BAR_COUNT);
  const bucketCount = Math.min(VOICE_WAVEFORM_BAR_COUNT, totalSamples);
  const points: number[] = [];
  for (let bar = 0; bar < bucketCount; bar += 1) {
    const start = Math.floor((bar * totalSamples) / bucketCount);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * totalSamples) / bucketCount));
    let squareSum = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = view.getInt16(sampleIndex * 2, true);
      const normalized = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
      squareSum += normalized * normalized;
    }
    points.push(analyserRmsToMatrixPoint(Math.sqrt(squareSum / (end - start))));
  }
  return normalizeMatrixWaveform(points, VOICE_WAVEFORM_BAR_COUNT);
};

/**
 * Stitches captured dictation segment WAVs into a single 16 kHz mono PCM16 voice message File
 * with duration and 48-bar Matrix waveform. Removes hard-cut overlap frames seamlessly and
 * returns any partial transcript covering missing WAVs in legacy recovered journals.
 */
export const buildDictationVoiceAudio = async (
  records: readonly RefinementSegmentRecord[],
  groups: readonly RefinementGroup[],
  nowMs = Date.now()
): Promise<DictationVoiceAudio | undefined> => {
  const audioEntries: Array<{ record: RefinementSegmentRecord & { wav: Blob }; index: number }> =
    [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record && hasUsableDictationWav(record.wav)) {
      audioEntries.push({ record: { ...record, wav: record.wav }, index: i });
    }
  }
  if (audioEntries.length === 0) return undefined;

  const slices: PlannedVoiceSlice[] = audioEntries.map((entry, i) => {
    const { record, index } = entry;
    const { wav } = record;
    const prev = i > 0 ? audioEntries[i - 1] : undefined;
    const next = i + 1 < audioEntries.length ? audioEntries[i + 1] : undefined;
    const adjacentFromPrev =
      prev !== undefined && record.segment.overlapped && index === prev.index + 1;
    const adjacentIntoNext =
      next !== undefined && next.record.segment.overlapped && next.index === index + 1;
    const dataBytes = wav.size - DICTATION_WAV_HEADER_BYTES;
    const frameAligned = dataBytes > 0 && dataBytes % FRAME_BYTES === 0;

    if (!frameAligned) {
      const evenDataBytes = dataBytes - (dataBytes % 2);
      return {
        wav,
        byteStart: DICTATION_WAV_HEADER_BYTES,
        byteEnd: DICTATION_WAV_HEADER_BYTES + evenDataBytes,
        keptLeading: 0,
        keptTrailing: 0,
        adjacentIntoNext,
      };
    }

    const totalFrames = dataBytes / FRAME_BYTES;
    const position: SegmentSlicePosition =
      audioEntries.length === 1
        ? 'only'
        : i === 0
          ? 'first'
          : i === audioEntries.length - 1
            ? 'last'
            : 'middle';
    const slice = computeSegmentSliceFrames({ ...record.segment, wav }, position);
    const startFrame = adjacentFromPrev
      ? Math.min(totalFrames, DICTATION_HARD_CUT_OVERLAP_FRAMES)
      : slice.startFrame;
    const endFrame = adjacentIntoNext ? totalFrames : Math.max(startFrame, slice.endFrame);

    return {
      wav,
      byteStart: DICTATION_WAV_HEADER_BYTES + startFrame * FRAME_BYTES,
      byteEnd: DICTATION_WAV_HEADER_BYTES + endFrame * FRAME_BYTES,
      keptLeading: startFrame === slice.startFrame ? slice.keptLeading : 0,
      keptTrailing: endFrame === slice.endFrame ? slice.keptTrailing : 0,
      adjacentIntoNext,
    };
  });

  const padAfterFrames: number[] = [];
  let totalPcmBytes = 0;
  for (let i = 0; i < slices.length; i += 1) {
    const slice = slices[i]!;
    totalPcmBytes += Math.max(0, slice.byteEnd - slice.byteStart);
    if (i + 1 < slices.length) {
      const next = slices[i + 1]!;
      const padFrames = slice.adjacentIntoNext
        ? 0
        : Math.max(0, MIN_INTERNAL_GAP_FRAMES - (slice.keptTrailing + next.keptLeading));
      padAfterFrames.push(padFrames);
      totalPcmBytes += padFrames * FRAME_BYTES;
    }
  }
  if (totalPcmBytes < 2) return undefined;

  // Snapshot any missing-WAV partial text before awaiting Blob reads so caller mutations cannot race.
  const missingAudioPartialText = extractMissingAudioPartialText(records, groups);

  const output = new Uint8Array(DICTATION_WAV_HEADER_BYTES + totalPcmBytes);
  output.set(new Uint8Array(buildPcm16WavHeader(totalPcmBytes, DICTATION_SAMPLE_RATE)), 0);

  const buffers = await Promise.all(
    slices.map((slice) =>
      slice.byteEnd > slice.byteStart
        ? slice.wav.slice(slice.byteStart, slice.byteEnd).arrayBuffer()
        : Promise.resolve(new ArrayBuffer(0))
    )
  );

  let offset = DICTATION_WAV_HEADER_BYTES;
  for (let i = 0; i < slices.length; i += 1) {
    const bytes = new Uint8Array(buffers[i]!);
    if (bytes.byteLength > 0) {
      output.set(bytes, offset);
      offset += bytes.byteLength;
    }
    const padFrames = padAfterFrames[i] ?? 0;
    if (padFrames > 0) {
      offset += padFrames * FRAME_BYTES;
    }
  }

  const totalSamples = Math.floor(totalPcmBytes / 2);
  const seconds = totalSamples / DICTATION_SAMPLE_RATE;
  const duration = Math.max(1, Math.round(seconds * 1000));
  const waveform = computeWaveformFromPcm16(
    new DataView(output.buffer, DICTATION_WAV_HEADER_BYTES, totalPcmBytes),
    totalSamples
  );
  const timestamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const file = new File([output], `voice-message-${timestamp}.wav`, { type: 'audio/wav' });

  return {
    file,
    duration,
    waveform,
    ...(missingAudioPartialText !== undefined ? { missingAudioPartialText } : {}),
  };
};
