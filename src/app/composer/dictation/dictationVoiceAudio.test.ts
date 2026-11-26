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

const makeConstFrame = (amplitude: number): Float32Array =>
  new Float32Array(DICTATION_FRAME_SAMPLES).fill(amplitude);

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
  const frames = opts.frames ?? [makeConstFrame(0.25), makeConstFrame(0.25)];
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

const readWavHeaderAndSamples = async (file: File) => {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );
  const sampleRate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  const frameValues: number[] = [];
  const totalFrames = Math.floor(dataBytes / FRAME_BYTES);
  for (let f = 0; f < totalFrames; f += 1) {
    frameValues.push(view.getInt16(DICTATION_WAV_HEADER_BYTES + f * FRAME_BYTES, true));
  }
  return {
    totalBytes: buf.byteLength,
    riff,
    wave,
    sampleRate,
    channels,
    bitsPerSample,
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
      ...Array.from({ length: 5 }, () => makeConstFrame(0)),
      makeConstFrame(0.1),
      makeConstFrame(0.4),
      makeConstFrame(0.8),
      makeConstFrame(0.2),
      ...Array.from({ length: 4 }, () => makeConstFrame(0)),
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
    expect(parsed.riff).toBe('RIFF');
    expect(parsed.wave).toBe('WAVE');
    expect(parsed.sampleRate).toBe(DICTATION_SAMPLE_RATE);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.totalFrames).toBe(9);
    expect(parsed.totalBytes).toBe(DICTATION_WAV_HEADER_BYTES + 9 * FRAME_BYTES);
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
      frames: [makeConstFrame(0.2), makeConstFrame(0.3)],
      cutReason: 'flush',
    });
    const seg1 = makeRecord({
      index: 1,
      frames: [makeConstFrame(0.5), makeConstFrame(0.6)],
      cutReason: 'natural',
    });

    const result = await buildDictationVoiceAudio([seg0, seg1], [], 1_700_000_000_000);
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
    // Hard cut 1 after frame 9 (frames 0..9); seg 1 overlaps last 6 frames (4..9) + continues 10..15.
    const seg0Frames = allFrames.slice(0, 10);
    const seg1Frames = allFrames.slice(10 - DICTATION_HARD_CUT_OVERLAP_FRAMES, 16);
    // Hard cut 2 after frame 15; seg 2 overlaps last 6 frames (10..15) + continues 16..19.
    const seg2Frames = allFrames.slice(16 - DICTATION_HARD_CUT_OVERLAP_FRAMES, 20);

    const records = [
      makeRecord({ index: 0, frames: seg0Frames, cutReason: 'hard', status: 'completed' }),
      makeRecord({
        index: 1,
        frames: seg1Frames,
        overlapped: true,
        cutReason: 'hard',
        status: 'completed',
      }),
      makeRecord({
        index: 2,
        frames: seg2Frames,
        overlapped: true,
        cutReason: 'flush',
        status: 'failed',
      }),
    ];

    const result = await buildDictationVoiceAudio(records, [], 1_700_000_000_000);
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
    const seg1Frames = seg0Frames.slice(10 - DICTATION_HARD_CUT_OVERLAP_FRAMES);

    const result = await buildDictationVoiceAudio(
      [
        makeRecord({ index: 0, frames: seg0Frames, cutReason: 'hard', status: 'completed' }),
        makeRecord({
          index: 1,
          frames: seg1Frames,
          overlapped: true,
          cutReason: 'flush',
          status: 'failed',
        }),
      ],
      [],
      1_700_000_000_000
    );
    expect(result).toBeDefined();
    const parsed = await readWavHeaderAndSamples(result!.file);
    expect(parsed.totalFrames).toBe(10);
  });

  it('handles non-frame-aligned WAVs and returns undefined when no usable WAVs exist', async () => {
    expect(await buildDictationVoiceAudio([], [])).toBeUndefined();
    expect(
      await buildDictationVoiceAudio(
        [makeRecord({ index: 0, withWav: false, status: 'completed', text: 'Only text' })],
        []
      )
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

    const result = await buildDictationVoiceAudio([rec], [], 1_700_000_000_000);
    expect(result).toBeDefined();
    expect(result!.file.size).toBe(DICTATION_WAV_HEADER_BYTES + 6);
    expect(result!.duration).toBe(1); // minimum 1 ms clamp
    expect(result!.waveform).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
  });

  it('extracts missingAudioPartialText for legacy journals with pruned earlier WAVs', async () => {
    // Legacy recovered journal: refined group [0, 1] had its WAVs pruned, seg 2 failed and kept its WAV.
    const records: RefinementSegmentRecord[] = [
      makeRecord({ index: 0, withWav: false, status: 'completed', text: 'First raw' }),
      makeRecord({ index: 1, withWav: false, status: 'completed', text: 'second raw' }),
      makeRecord({
        index: 2,
        frames: [makeConstFrame(0.4), makeConstFrame(0.4)],
        status: 'failed',
      }),
    ];
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

    const result = await buildDictationVoiceAudio(records, groups, 1_700_000_000_000);
    expect(result).toBeDefined();
    expect(result!.missingAudioPartialText).toBe('First and second refined.');
    const parsed = await readWavHeaderAndSamples(result!.file);
    expect(parsed.totalFrames).toBe(2);

    // When a refined group still has one WAV present, only missing-WAV primary segments emit partial text.
    const mixedRecords: RefinementSegmentRecord[] = [
      makeRecord({ index: 0, withWav: false, status: 'completed', text: 'Missing audio text.' }),
      makeRecord({
        index: 1,
        frames: [makeConstFrame(0.3)],
        status: 'completed',
        text: 'Still has audio.',
      }),
    ];
    const mixedGroups: RefinementGroup[] = [
      {
        startIndex: 0,
        endIndex: 1,
        state: 'refined',
        refinedText: 'Missing audio text. Still has audio.',
        refinedEndIndex: 1,
      },
    ];
    const mixed = await buildDictationVoiceAudio(mixedRecords, mixedGroups, 1_700_000_000_000);
    expect(mixed?.missingAudioPartialText).toBe('Missing audio text.');

    // Without groups, completed missing-WAV primaries stitch cleanly and orphaned overlapped audio keeps leading frames.
    const noGroupRecords: RefinementSegmentRecord[] = [
      makeRecord({
        index: 0,
        withWav: false,
        status: 'completed',
        text: 'Part one',
        cutReason: 'hard',
      }),
      makeRecord({
        index: 1,
        frames: Array.from({ length: 8 }, () => makeConstFrame(0.3)),
        overlapped: true,
        status: 'failed',
      }),
    ];
    const noGroup = await buildDictationVoiceAudio(noGroupRecords, [], 1_700_000_000_000);
    expect(noGroup?.missingAudioPartialText).toBe('Part one');
    const noGroupParsed = await readWavHeaderAndSamples(noGroup!.file);
    expect(noGroupParsed.totalFrames).toBe(8);
  });
});
