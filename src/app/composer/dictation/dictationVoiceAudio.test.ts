import { describe, expect, it } from 'vitest';
import { VOICE_WAVEFORM_BAR_COUNT, VOICE_WAVEFORM_MAX } from '../../lib/audioWaveform';
import {
  MIN_INTERNAL_GAP_FRAMES,
  type RefinementGroup,
  type RefinementSegmentRecord,
} from './dictationRefinement';
import {
  buildPcm16WavHeader,
  DICTATION_FRAME_MS,
  DICTATION_FRAME_SAMPLES,
  DICTATION_HARD_CUT_OVERLAP_FRAMES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
  encodePcm16Wav,
  type DictationSegmentCutReason,
} from './dictationSegmenter';
import { buildDictationVoiceAudio, hasUsableDictationWav } from './dictationVoiceAudio';

const FRAME_BYTES = DICTATION_FRAME_SAMPLES * 2;
const NOW = 1_700_000_000_000;

const makeConstFrame = (amplitude: number): Float32Array =>
  new Float32Array(DICTATION_FRAME_SAMPLES).fill(amplitude);

const constFrames = (count: number, amplitude: number): Float32Array[] =>
  Array.from({ length: count }, () => makeConstFrame(amplitude));

const makeRecord = (opts: {
  index: number;
  frames?: Float32Array[];
  leadingQuietFrames?: number;
  trailingQuietFrames?: number;
  overlapped?: boolean;
  cutReason?: DictationSegmentCutReason;
  status?: RefinementSegmentRecord['status'];
  text?: string;
  withWav?: boolean;
}): RefinementSegmentRecord => {
  const frames = opts.frames ?? constFrames(2, 0.25);
  const wav = opts.withWav === false ? undefined : encodePcm16Wav(frames, DICTATION_SAMPLE_RATE);
  return {
    segment: {
      index: opts.index,
      seconds: (frames.length * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      overlapped: opts.overlapped ?? false,
      cutReason: opts.cutReason ?? 'natural',
      leadingQuietFrames: opts.leadingQuietFrames ?? 0,
      trailingQuietFrames: opts.trailingQuietFrames ?? 0,
      pauseBeforeMs: Infinity,
    },
    wav,
    status: opts.status ?? 'failed',
    ...(opts.text !== undefined ? { text: opts.text } : {}),
  };
};

const makeTextOnlyRecord = (
  index: number,
  text: string,
  cutReason?: DictationSegmentCutReason
): RefinementSegmentRecord =>
  makeRecord({ index, withWav: false, status: 'completed', text, cutReason });

const fourcc = (view: DataView, offset: number): string =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );

const readWavHeaderAndSamples = async (file: File) => {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const dataBytes = view.getUint32(40, true);
  const totalFrames = Math.floor(dataBytes / FRAME_BYTES);
  const frameValues = Array.from({ length: totalFrames }, (_, f) =>
    view.getInt16(DICTATION_WAV_HEADER_BYTES + f * FRAME_BYTES, true)
  );
  return {
    totalBytes: buf.byteLength,
    riff: fourcc(view, 0),
    wave: fourcc(view, 8),
    sampleRate: view.getUint32(24, true),
    channels: view.getUint16(22, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes,
    totalFrames,
    frameValues,
  };
};

describe('dictationVoiceAudio', () => {
  it('detects usable PCM16 WAV blobs containing at least one sample', () => {
    expect(hasUsableDictationWav(undefined)).toBe(false);
    expect(hasUsableDictationWav(new Blob([new Uint8Array(DICTATION_WAV_HEADER_BYTES)]))).toBe(
      false
    );
    expect(hasUsableDictationWav(new Blob([new Uint8Array(DICTATION_WAV_HEADER_BYTES + 1)]))).toBe(
      false
    );
    expect(hasUsableDictationWav(new Blob([new Uint8Array(DICTATION_WAV_HEADER_BYTES + 2)]))).toBe(
      true
    );
  });

  it('stitches a single segment into a valid 16 kHz mono WAV with accurate duration and 48-bar waveform', async () => {
    // 5 leading quiet + 4 voiced + 4 trailing quiet -> outer trims to 3 leading + 4 voiced + 2 trailing = 9 frames.
    const frames = [
      ...constFrames(5, 0),
      ...[0.1, 0.4, 0.8, 0.2].map(makeConstFrame),
      ...constFrames(4, 0),
    ];
    const record = makeRecord({
      index: 0,
      frames,
      leadingQuietFrames: 5,
      trailingQuietFrames: 4,
    });
    const fixedNow = Date.UTC(2026, 10, 26, 12, 34, 56, 789);

    const result = await buildDictationVoiceAudio([record], [], fixedNow);
    expect(result).toBeDefined();
    expect(result!.missingAudioPartialText).toBeUndefined();
    expect(result!.file.type).toBe('audio/wav');
    expect(result!.file.name).toBe('voice-message-2026-11-26T12-34-56-789Z.wav');

    const parsed = await readWavHeaderAndSamples(result!.file);
    expect(parsed).toMatchObject({
      riff: 'RIFF',
      wave: 'WAVE',
      sampleRate: DICTATION_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      totalFrames: 9,
      totalBytes: DICTATION_WAV_HEADER_BYTES + 9 * FRAME_BYTES,
    });
    expect(result!.duration).toBe(Math.round(9 * DICTATION_FRAME_MS));

    expect(result!.waveform).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(
      result!.waveform.every((v) => Number.isInteger(v) && v >= 0 && v <= VOICE_WAVEFORM_MAX)
    ).toBe(true);
    // Quiet outer edges stay near zero while the 0.8-amplitude peak produces high bars in the middle.
    expect(result!.waveform[0]).toBe(0);
    expect(result!.waveform[result!.waveform.length - 1]).toBe(0);
    expect(Math.max(...result!.waveform)).toBeGreaterThan(800);
  });

  it('pads multi-segment natural/soft pauses up to MIN_INTERNAL_GAP_FRAMES silence', async () => {
    const seg0 = makeRecord({
      index: 0,
      frames: [0.2, 0.3].map(makeConstFrame),
      cutReason: 'flush',
    });
    const seg1 = makeRecord({
      index: 1,
      frames: [0.5, 0.6].map(makeConstFrame),
      cutReason: 'natural',
    });

    const result = await buildDictationVoiceAudio([seg0, seg1], [], NOW);
    expect(result).toBeDefined();

    const parsed = await readWavHeaderAndSamples(result!.file);
    expect(parsed.totalFrames).toBe(2 + MIN_INTERNAL_GAP_FRAMES + 2);
    // Middle gap frames are zero-padded PCM silence.
    expect(parsed.frameValues.slice(2, 2 + MIN_INTERNAL_GAP_FRAMES)).toEqual(
      Array.from({ length: MIN_INTERNAL_GAP_FRAMES }, () => 0)
    );
    expect(parsed.frameValues[0]).toBeGreaterThan(0);
    expect(parsed.frameValues[1]).toBeGreaterThan(parsed.frameValues[0]!);
    expect(parsed.frameValues[2 + MIN_INTERNAL_GAP_FRAMES]).toBeGreaterThan(parsed.frameValues[1]!);
    expect(result!.duration).toBe(Math.round((4 + MIN_INTERNAL_GAP_FRAMES) * DICTATION_FRAME_MS));
  });

  it('removes hard-cut overlap frames with zero gap across single and chained hard cuts', async () => {
    // Build a continuous 20-frame signal where each frame has a distinct sample value.
    const allFrames = Array.from({ length: 20 }, (_, i) => makeConstFrame((i + 1) / 25));
    const records = [
      makeRecord({
        index: 0,
        frames: allFrames.slice(0, 10),
        cutReason: 'hard',
        status: 'completed',
      }),
      makeRecord({
        index: 1,
        frames: allFrames.slice(10 - DICTATION_HARD_CUT_OVERLAP_FRAMES, 16),
        overlapped: true,
        cutReason: 'hard',
        status: 'completed',
      }),
      makeRecord({
        index: 2,
        frames: allFrames.slice(16 - DICTATION_HARD_CUT_OVERLAP_FRAMES, 20),
        overlapped: true,
        cutReason: 'flush',
        status: 'failed',
      }),
    ];

    const result = await buildDictationVoiceAudio(records, [], NOW);
    expect(result).toBeDefined();

    const parsed = await readWavHeaderAndSamples(result!.file);
    expect(parsed.totalFrames).toBe(20);
    // Verify strictly monotonic sample values matching frames 0..19 with zero duplicates and zero silence gaps.
    const expectedSamples = allFrames.map((f) => Math.trunc(f[0]! * 0x7fff));
    expect(parsed.frameValues).toEqual(expectedSamples);
  });

  it('drops exact-overlap-length hard-cut continuation without duplicating frames', async () => {
    const seg0Frames = Array.from({ length: 10 }, (_, i) => makeConstFrame((i + 1) / 20));
    // Immediate stop after hard cut: seg 1 contains only the 6 overlap frames already at the end of seg 0.
    const result = await buildDictationVoiceAudio(
      [
        makeRecord({ index: 0, frames: seg0Frames, cutReason: 'hard', status: 'completed' }),
        makeRecord({
          index: 1,
          frames: seg0Frames.slice(10 - DICTATION_HARD_CUT_OVERLAP_FRAMES),
          overlapped: true,
          cutReason: 'flush',
          status: 'failed',
        }),
      ],
      [],
      NOW
    );
    expect(result).toBeDefined();
    expect((await readWavHeaderAndSamples(result!.file)).totalFrames).toBe(10);
  });

  it('handles non-frame-aligned WAVs and returns undefined when no usable WAVs exist', async () => {
    expect(await buildDictationVoiceAudio([], [])).toBeUndefined();
    expect(
      await buildDictationVoiceAudio([makeTextOnlyRecord(0, 'Only text')], [])
    ).toBeUndefined();

    // Odd byte count (header + 7 bytes -> truncated to 6 bytes = 3 PCM16 samples).
    const raw = new Uint8Array(DICTATION_WAV_HEADER_BYTES + 7);
    raw.set(new Uint8Array(buildPcm16WavHeader(7, DICTATION_SAMPLE_RATE)), 0);
    const dv = new DataView(raw.buffer);
    dv.setInt16(DICTATION_WAV_HEADER_BYTES, 1000, true);
    dv.setInt16(DICTATION_WAV_HEADER_BYTES + 2, -2000, true);
    dv.setInt16(DICTATION_WAV_HEADER_BYTES + 4, 3000, true);
    const rec = makeRecord({ index: 0 });
    rec.wav = new Blob([raw], { type: 'audio/wav' });

    const result = await buildDictationVoiceAudio([rec], [], NOW);
    expect(result).toBeDefined();
    expect(result!.file.size).toBe(DICTATION_WAV_HEADER_BYTES + 6);
    expect(result!.duration).toBe(1); // minimum 1 ms clamp
    expect(result!.waveform).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
  });

  it('extracts missingAudioPartialText for legacy journals with pruned earlier WAVs', async () => {
    // Legacy recovered journal: refined group [0, 1] had its WAVs pruned, seg 2 failed and kept its WAV.
    const groups: RefinementGroup[] = [
      {
        startIndex: 0,
        endIndex: 1,
        state: 'refined',
        refinedText: 'First and second refined.',
        refinedEndIndex: 1,
      },
      { startIndex: 2, endIndex: 2, state: 'fallback' },
    ];
    const result = await buildDictationVoiceAudio(
      [
        makeTextOnlyRecord(0, 'First raw'),
        makeTextOnlyRecord(1, 'second raw'),
        makeRecord({ index: 2, frames: constFrames(2, 0.4), status: 'failed' }),
      ],
      groups,
      NOW
    );
    expect(result).toBeDefined();
    expect(result!.missingAudioPartialText).toBe('First and second refined.');
    expect((await readWavHeaderAndSamples(result!.file)).totalFrames).toBe(2);

    // When a refined group still has one WAV present, only missing-WAV primary segments emit partial text.
    const mixed = await buildDictationVoiceAudio(
      [
        makeTextOnlyRecord(0, 'Missing audio text.'),
        makeRecord({
          index: 1,
          frames: [makeConstFrame(0.3)],
          status: 'completed',
          text: 'Still has audio.',
        }),
      ],
      [
        {
          startIndex: 0,
          endIndex: 1,
          state: 'refined',
          refinedText: 'Missing audio text. Still has audio.',
          refinedEndIndex: 1,
        },
      ],
      NOW
    );
    expect(mixed?.missingAudioPartialText).toBe('Missing audio text.');

    // Without groups, completed missing-WAV primaries stitch cleanly and orphaned overlapped audio keeps leading frames.
    const noGroup = await buildDictationVoiceAudio(
      [
        makeTextOnlyRecord(0, 'Part one', 'hard'),
        makeRecord({ index: 1, frames: constFrames(8, 0.3), overlapped: true, status: 'failed' }),
      ],
      [],
      NOW
    );
    expect(noGroup?.missingAudioPartialText).toBe('Part one');
    expect((await readWavHeaderAndSamples(noGroup!.file)).totalFrames).toBe(8);
  });
});
