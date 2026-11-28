import {
  analyserRmsToMatrixPoint,
  normalizeMatrixWaveform,
  VOICE_WAVEFORM_BAR_COUNT,
} from '../../lib/audioWaveform';
import {
  computeSegmentSliceFrames,
  getRefinementGroupCoveredEnd,
  isFrameAlignedWav,
  MIN_INTERNAL_GAP_FRAMES,
  segmentSlicePosition,
  stitchRefinedSegments,
  type RefinementGroup,
  type RefinementSegmentRecord,
} from './dictationRefinement';
import {
  buildPcm16WavHeader,
  DICTATION_FRAME_SAMPLES,
  DICTATION_HARD_CUT_OVERLAP_FRAMES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
} from './dictationSegmenter';

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

  const maskedRecords = records.map((record) =>
    hasUsableDictationWav(record.wav)
      ? { ...record, status: 'failed' as const, text: undefined }
      : record
  );
  const effectiveGroups: RefinementGroup[] =
    groups.length === 0
      ? [{ startIndex: 0, endIndex: records.length - 1, state: 'fallback' }]
      : groups.map((group) => {
          const coveredEnd = Math.min(getRefinementGroupCoveredEnd(group), records.length - 1);
          const keepRefined =
            coveredEnd >= group.startIndex &&
            records
              .slice(group.startIndex, coveredEnd + 1)
              .every((record) => !hasUsableDictationWav(record.wav));
          return keepRefined
            ? { ...group, refinedEndIndex: coveredEnd }
            : { ...group, refinedText: undefined };
        });

  const stitched = stitchRefinedSegments(maskedRecords, effectiveGroups);
  return stitched.length > 0 ? stitched : undefined;
};

type PcmPart = Blob | Uint8Array<ArrayBuffer>;

const computeWaveformFromPcm16 = async (
  parts: readonly PcmPart[],
  totalSamples: number
): Promise<number[]> => {
  const bucketCount = Math.min(VOICE_WAVEFORM_BAR_COUNT, totalSamples);
  const ends = Array.from({ length: bucketCount }, (_, bar) =>
    Math.floor(((bar + 1) * totalSamples) / bucketCount)
  );
  const squareSums = new Float64Array(bucketCount);
  let sampleIndex = 0;
  let bar = 0;
  for (const part of parts) {
    if (!(part instanceof Blob)) {
      // Uint8Array parts are zero-filled silence pads, with no contribution to RMS.
      sampleIndex += part.byteLength / 2;
      while (bar < bucketCount && sampleIndex >= ends[bar]!) bar += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- Only materialize one segment at a time.
    const view = new DataView(await part.arrayBuffer());
    const start = sampleIndex;
    const end = start + view.byteLength / 2;
    while (sampleIndex < end) {
      const bucketEnd = ends[bar]!;
      const stop = Math.min(bucketEnd, end);
      let squareSum = squareSums[bar]!;
      for (; sampleIndex < stop; sampleIndex += 1) {
        const sample = view.getInt16((sampleIndex - start) * 2, true);
        const normalized = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
        squareSum += normalized * normalized;
      }
      squareSums[bar] = squareSum;
      if (sampleIndex === bucketEnd) bar += 1;
    }
  }
  const points = ends.map((end, i) =>
    analyserRmsToMatrixPoint(Math.sqrt(squareSums[i]! / (end - (ends[i - 1] ?? 0))))
  );
  return normalizeMatrixWaveform(points, VOICE_WAVEFORM_BAR_COUNT);
};

/**
 * Stitches captured dictation segment WAVs into a single 16 kHz mono PCM16 voice message File
 * with duration and 48-bar Matrix waveform. Removes hard-cut overlap frames seamlessly and
 * returns any partial transcript covering pruned or otherwise missing WAVs.
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

  const slices = audioEntries.map(({ record, index }, i) => {
    const { wav } = record;
    const prev = audioEntries[i - 1];
    const next = audioEntries[i + 1];
    const adjacentFromPrev =
      prev !== undefined && record.segment.overlapped && index === prev.index + 1;
    const adjacentIntoNext =
      next !== undefined && next.record.segment.overlapped && next.index === index + 1;
    const dataBytes = wav.size - DICTATION_WAV_HEADER_BYTES;

    if (!isFrameAlignedWav(wav)) {
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
    const slice = computeSegmentSliceFrames(
      { ...record.segment, wav },
      segmentSlicePosition(i, audioEntries.length)
    );
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

  const pcmParts: PcmPart[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    const slice = slices[i]!;
    if (slice.byteEnd > slice.byteStart) {
      pcmParts.push(slice.wav.slice(slice.byteStart, slice.byteEnd));
    }
    const next = slices[i + 1];
    if (next) {
      const padFrames = slice.adjacentIntoNext
        ? 0
        : Math.max(0, MIN_INTERNAL_GAP_FRAMES - (slice.keptTrailing + next.keptLeading));
      if (padFrames > 0) pcmParts.push(new Uint8Array(padFrames * FRAME_BYTES));
    }
  }
  const totalPcmBytes = pcmParts.reduce(
    (total, part) => total + (part instanceof Blob ? part.size : part.byteLength),
    0
  );
  if (totalPcmBytes < 2) return undefined;

  // Snapshot any missing-WAV partial text before awaiting Blob reads so caller mutations cannot race.
  const missingAudioPartialText = extractMissingAudioPartialText(records, groups);

  const totalSamples = totalPcmBytes / 2;
  const duration = Math.max(1, Math.round((totalSamples / DICTATION_SAMPLE_RATE) * 1000));
  const waveform = await computeWaveformFromPcm16(pcmParts, totalSamples);
  const timestamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const file = new File(
    [buildPcm16WavHeader(totalPcmBytes, DICTATION_SAMPLE_RATE), ...pcmParts],
    `voice-message-${timestamp}.wav`,
    { type: 'audio/wav' }
  );

  return {
    file,
    duration,
    waveform,
    ...(missingAudioPartialText !== undefined ? { missingAudioPartialText } : {}),
  };
};
