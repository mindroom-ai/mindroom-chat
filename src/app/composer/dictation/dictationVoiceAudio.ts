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

  const pcmParts: BlobPart[] = [];
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
  const pcmBlob = new Blob(pcmParts);
  if (pcmBlob.size < 2) return undefined;

  // Snapshot any missing-WAV partial text before awaiting Blob reads so caller mutations cannot race.
  const missingAudioPartialText = extractMissingAudioPartialText(records, groups);

  const pcmBuffer = await pcmBlob.arrayBuffer();
  const totalSamples = Math.floor(pcmBuffer.byteLength / 2);
  const duration = Math.max(1, Math.round((totalSamples / DICTATION_SAMPLE_RATE) * 1000));
  const waveform = computeWaveformFromPcm16(new DataView(pcmBuffer), totalSamples);
  const timestamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const file = new File(
    [buildPcm16WavHeader(pcmBuffer.byteLength, DICTATION_SAMPLE_RATE), pcmBuffer],
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
