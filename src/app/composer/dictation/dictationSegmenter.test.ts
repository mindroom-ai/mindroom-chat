import { describe, expect, it, vi } from 'vitest';
import {
  DICTATION_FRAME_SAMPLES,
  DICTATION_MAX_SEGMENT_BYTES,
  DICTATION_SAMPLE_RATE,
  DictationSegmenter,
  encodePcm16Wav,
  type DictationSegment,
} from './dictationSegmenter';

const makeFrame = (amplitude: number): Float32Array => {
  const frame = new Float32Array(DICTATION_FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i += 1) {
    // 440 Hz sine wave gives deterministic RMS = amplitude / sqrt(2).
    frame[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / DICTATION_SAMPLE_RATE);
  }
  return frame;
};

const readWavHeader = async (blob: Blob) => {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...new Uint8Array(buffer, offset, length));
  return {
    byteLength: buffer.byteLength,
    riff: ascii(0, 4),
    chunkSize: view.getUint32(4, true),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(36, 4),
    dataBytes: view.getUint32(40, true),
    firstSample: buffer.byteLength >= 46 ? view.getInt16(44, true) : 0,
  };
};

describe('encodePcm16Wav', () => {
  it('writes a valid 16 kHz mono 16-bit PCM WAV header and clamped samples', async () => {
    const samples = new Float32Array([0, 1, -1, 0.5, 2, -2]);
    const wav = encodePcm16Wav([samples]);
    expect(wav.type).toBe('audio/wav');

    const header = await readWavHeader(wav);
    expect(header).toMatchObject({
      byteLength: 44 + 6 * 2,
      riff: 'RIFF',
      chunkSize: 36 + 12,
      wave: 'WAVE',
      fmt: 'fmt ',
      audioFormat: 1,
      channels: 1,
      sampleRate: 16_000,
      byteRate: 32_000,
      blockAlign: 2,
      bitsPerSample: 16,
      data: 'data',
      dataBytes: 12,
      firstSample: 0,
    });

    const view = new DataView(await wav.arrayBuffer());
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(32767);
    expect(view.getInt16(54, true)).toBe(-32768);
  });
});

describe('DictationSegmenter', () => {
  it('buffers frames from t=0 while ONNX loads and catches up without clipping initial syllables', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    // Speech arrives immediately from t=0 before VAD finishes loading.
    const probs: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      segmenter.pushFrame(makeFrame(0.3));
      probs.push(0.9);
    }
    for (let i = 0; i < 8; i += 1) {
      segmenter.pushFrame(makeFrame(0.002));
      probs.push(0.05);
    }
    expect(segments).toHaveLength(0);

    let cursor = 0;
    await segmenter.attachVad({
      score: async () => probs[cursor++] ?? 0.05,
    });

    expect(segments).toHaveLength(1);
    const [seg] = segments;
    expect(seg).toBeDefined();
    expect(seg!.overlapped).toBe(false);
    // All 6 speech frames + 8 redemption frames = 14 frames -> zero initial frames dropped.
    expect(seg!.seconds).toBeCloseTo((14 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE, 3);
    const header = await readWavHeader(seg!.wav);
    expect(header.riff).toBe('RIFF');
    expect(header.dataBytes).toBe(14 * DICTATION_FRAME_SAMPLES * 2);
  });

  it('cuts on natural pauses with 4 pre-speech pad frames, 8 redemption frames, and 0 overlap', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    const probs: number[] = [];
    const frames: Float32Array[] = [];
    const push = (count: number, amp: number, prob: number) => {
      for (let i = 0; i < count; i += 1) {
        frames.push(makeFrame(amp));
        probs.push(prob);
      }
    };
    push(7, 0.002, 0.05); // 7 leading quiet frames -> only last 4 kept as preSpeechPad
    push(5, 0.25, 0.85); // 5 speech frames
    push(8, 0.002, 0.1); // 8 redemption frames trigger pause cut

    let idx = 0;
    await segmenter.attachVad({ score: async () => probs[idx++] ?? 0 });
    for (const frame of frames) segmenter.pushFrame(frame);
    await segmenter.flush('finish');

    expect(segments).toHaveLength(1);
    expect(segments[0]?.overlapped).toBe(false);
    // 4 pad + 5 speech + 8 redemption = 17 frames.
    expect(segments[0]?.seconds).toBeCloseTo(
      (17 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      3
    );
  });

  it('performs a soft valley cut past 15 s on >= 2 frames with speechProb < 0.35', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    const probs: number[] = [];
    // 157 frames (~15.07 s) of continuous speech, followed by 2 quiet frames (< 0.35).
    for (let i = 0; i < 157; i += 1) probs.push(0.9);
    probs.push(0.2, 0.15);

    let idx = 0;
    await segmenter.attachVad({ score: async () => probs[idx++] ?? 0 });
    for (let i = 0; i < probs.length; i += 1) {
      segmenter.pushFrame(makeFrame(i < 157 ? 0.3 : 0.01));
    }
    await segmenter.flush('pause');

    expect(segments).toHaveLength(1);
    expect(segments[0]?.overlapped).toBe(false);
    expect(segments[0]?.seconds).toBeGreaterThan(15);
    expect(segments[0]?.seconds).toBeLessThan(16);
  });

  it('performs a hard cut at 25 s at the lowest-prob/RMS frame in the trailing 1 s carrying 6 overlap frames', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    // 260 frames (~24.96 s) of nonstop speech with a clear minimum at index 255 (inside trailing 10 frames).
    const totalFrames = 266;
    const probs = Array.from({ length: totalFrames }, (_, i) => {
      if (i === 255) return 0.52; // lowest prob in trailing 1 s
      return 0.9;
    });

    let idx = 0;
    await segmenter.attachVad({ score: async () => probs[idx++] ?? 0.9 });
    for (let i = 0; i < totalFrames; i += 1) {
      segmenter.pushFrame(makeFrame(i === 255 ? 0.05 : 0.3));
    }
    await segmenter.flush('finish');

    expect(segments).toHaveLength(2);
    expect(segments[0]?.overlapped).toBe(false);
    // Cut happened at index 255 (256 frames emitted in segment 0).
    expect(segments[0]?.seconds).toBeCloseTo(
      (256 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      3
    );
    expect(segments[0]!.wav.size).toBeLessThanOrEqual(DICTATION_MAX_SEGMENT_BYTES);

    // Segment 1 is flagged overlapped: true and carries 6 overlap frames + remaining 10 frames = 16 frames.
    expect(segments[1]?.overlapped).toBe(true);
    expect(segments[1]?.seconds).toBeCloseTo(
      (16 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      3
    );
  });

  it('preserves short ~192 ms utterances on Finish flush while dropping pure silence', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    // Case 1: Pure silence produces zero segments.
    const silenceProbs = Array.from({ length: 15 }, () => 0.05);
    let idx = 0;
    await segmenter.attachVad({ score: async () => silenceProbs[idx++] ?? 0.05 });
    for (let i = 0; i < 15; i += 1) segmenter.pushFrame(makeFrame(0.0001));
    await segmenter.flush('finish');
    expect(segments).toHaveLength(0);

    // Case 2: Crisp 2-frame (~192 ms) "Yes" survives Finish flush.
    const shortSegs: DictationSegment[] = [];
    const shortSegmenter = new DictationSegmenter({ onSegment: (seg) => shortSegs.push(seg) });
    const shortProbs = [0.85, 0.45];
    let sIdx = 0;
    await shortSegmenter.attachVad({ score: async () => shortProbs[sIdx++] ?? 0.05 });
    shortSegmenter.pushFrame(makeFrame(0.25));
    shortSegmenter.pushFrame(makeFrame(0.2));
    await shortSegmenter.flush('finish');

    expect(shortSegs).toHaveLength(1);
    expect(shortSegs[0]?.seconds).toBeCloseTo(
      (2 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      3
    );
  });

  it('falls back to buffered PCM WAV and RMS-valley splitting past 20 s when WASM fails', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    // Buffer 209 frames (~20.06 s) of speech + 2 quiet RMS valley frames while loading.
    for (let i = 0; i < 209; i += 1) segmenter.pushFrame(makeFrame(0.2));
    segmenter.pushFrame(makeFrame(0.002));
    segmenter.pushFrame(makeFrame(0.002));
    // Then 10 more speech frames.
    for (let i = 0; i < 10; i += 1) segmenter.pushFrame(makeFrame(0.2));

    // WASM load fails -> replays buffered frames via RMS fallback.
    segmenter.markVadFailed();
    await segmenter.flush('finish');

    expect(segments).toHaveLength(2);
    expect(segments[0]?.overlapped).toBe(false);
    expect(segments[0]?.seconds).toBeGreaterThan(20);
    expect(segments[1]?.overlapped).toBe(false);
    expect(segments[1]!.wav.size).toBeLessThanOrEqual(DICTATION_MAX_SEGMENT_BYTES);
  });

  it('falls back cleanly when Finish is clicked before WASM finishes loading', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    for (let i = 0; i < 5; i += 1) segmenter.pushFrame(makeFrame(0.25));
    await segmenter.flush('finish');

    expect(segments).toHaveLength(1);
    const header = await readWavHeader(segments[0]!.wav);
    expect(header.riff).toBe('RIFF');
    expect(header.sampleRate).toBe(16_000);
  });

  it('enforces the 5-minute active frame cap and notifies once', () => {
    const onCapReached = vi.fn();
    const segmenter = new DictationSegmenter({
      onSegment: () => undefined,
      onCapReached,
      maxActiveFrames: 5,
    });

    for (let i = 0; i < 10; i += 1) segmenter.pushFrame(makeFrame(0.1));
    expect(segmenter.isCapReached).toBe(true);
    expect(onCapReached).toHaveBeenCalledTimes(1);
  });
});
