import { describe, expect, it, vi } from 'vitest';
import { stitchTranscript } from './stitchTranscript';
import {
  decodePcm16Frames,
  DICTATION_FRAME_MS,
  DICTATION_FRAME_SAMPLES,
  DICTATION_MAX_SEGMENT_BYTES,
  DICTATION_SAMPLE_RATE,
  DictationSegmenter,
  encodePcm16Frames,
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
    await segmenter.flush();

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
    await segmenter.flush();

    expect(segments).toHaveLength(1);
    expect(segments[0]?.overlapped).toBe(false);
    expect(segments[0]?.cutReason).toBe('soft');
    expect(segments[0]?.leadingQuietFrames).toBe(0);
    expect(segments[0]?.trailingQuietFrames).toBe(2);
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
    await segmenter.flush();

    expect(segments).toHaveLength(2);
    expect(segments[0]?.overlapped).toBe(false);
    expect(segments[0]?.cutReason).toBe('hard');
    expect(segments[0]?.trailingQuietFrames).toBe(0);
    // Cut happened at index 255 (256 frames emitted in segment 0).
    expect(segments[0]?.seconds).toBeCloseTo(
      (256 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      3
    );
    expect(segments[0]!.wav.size).toBeLessThanOrEqual(DICTATION_MAX_SEGMENT_BYTES);

    // Segment 1 is flagged overlapped: true and carries 6 overlap frames + remaining 10 frames = 16 frames.
    expect(segments[1]?.overlapped).toBe(true);
    expect(segments[1]?.cutReason).toBe('flush');
    expect(segments[1]?.pauseBeforeMs).toBe(0);
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
    await segmenter.flush();
    expect(segments).toHaveLength(0);

    // Case 2: Crisp 2-frame (~192 ms) "Yes" survives Finish flush.
    const shortSegs: DictationSegment[] = [];
    const shortSegmenter = new DictationSegmenter({ onSegment: (seg) => shortSegs.push(seg) });
    const shortProbs = [0.85, 0.45];
    let sIdx = 0;
    await shortSegmenter.attachVad({ score: async () => shortProbs[sIdx++] ?? 0.05 });
    shortSegmenter.pushFrame(makeFrame(0.25));
    shortSegmenter.pushFrame(makeFrame(0.2));
    await shortSegmenter.flush();

    expect(shortSegs).toHaveLength(1);
    expect(shortSegs[0]?.seconds).toBeCloseTo(
      (2 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
      3
    );

    // Case 3: Crisp 2-frame (~192 ms) "Yes" also survives a natural pause (8 quiet frames).
    const pauseSegs: DictationSegment[] = [];
    const pauseSegmenter = new DictationSegmenter({ onSegment: (seg) => pauseSegs.push(seg) });
    const pauseProbs = [0.85, 0.8, ...Array.from({ length: 8 }, () => 0.05)];
    let pIdx = 0;
    await pauseSegmenter.attachVad({ score: async () => pauseProbs[pIdx++] ?? 0.05 });
    pauseSegmenter.pushFrame(makeFrame(0.25));
    pauseSegmenter.pushFrame(makeFrame(0.22));
    for (let i = 0; i < 8; i += 1) pauseSegmenter.pushFrame(makeFrame(0.001));
    await pauseSegmenter.flush();
    expect(pauseSegs).toHaveLength(1);
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
    await segmenter.markVadFailed();
    await segmenter.flush();

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
    await segmenter.flush();

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
    expect(onCapReached).toHaveBeenCalledTimes(1);
  });

  it('records cutReason, leading/trailing quiet frames, and deterministic pauseBeforeMs across pauses and flush', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });
    await segmenter.attachVad({
      score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
    });

    const pushMany = (count: number, amp: number) => {
      for (let i = 0; i < count; i += 1) segmenter.pushFrame(makeFrame(amp));
    };

    // Seg 0: 6 leading quiet (4 pad kept) + 4 voiced + 8 redemption -> natural cut, pauseBeforeMs = Infinity.
    pushMany(6, 0.001);
    pushMany(4, 0.3);
    pushMany(8, 0.001);
    // 10 quiet frames between seg 0 and seg 1 (6 dropped + 4 in preSpeechPad) -> total pause = (8 + 10) * 96 ms.
    pushMany(10, 0.001);
    pushMany(3, 0.3);
    pushMany(8, 0.001);
    // 2 quiet frames (all 2 in preSpeechPad, 0 dropped) + 3 voiced -> flushed mid-speech.
    pushMany(2, 0.001);
    pushMany(3, 0.3);
    await segmenter.flush();

    // Post-flush segment starts a fresh pause boundary (pauseBeforeMs = Infinity).
    pushMany(3, 0.3);
    await segmenter.flush();

    expect(segments).toHaveLength(4);
    expect(segments[0]).toMatchObject({
      cutReason: 'natural',
      leadingQuietFrames: 4,
      trailingQuietFrames: 8,
      pauseBeforeMs: Infinity,
    });
    expect(segments[1]).toMatchObject({
      cutReason: 'natural',
      leadingQuietFrames: 4,
      trailingQuietFrames: 8,
      pauseBeforeMs: 18 * DICTATION_FRAME_MS,
    });
    expect(segments[2]).toMatchObject({
      cutReason: 'flush',
      leadingQuietFrames: 2,
      trailingQuietFrames: 0,
      pauseBeforeMs: 10 * DICTATION_FRAME_MS,
    });
    expect(segments[3]).toMatchObject({
      cutReason: 'flush',
      leadingQuietFrames: 0,
      trailingQuietFrames: 0,
      pauseBeforeMs: Infinity,
    });
  });

  it('fires onLongSilence once at ~8 s idle silence and resets on next segment or flush', async () => {
    const onLongSilence = vi.fn();
    const scorer = {
      score: async (frame: Float32Array) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
    };
    const segmenter = new DictationSegmenter({ onSegment: () => undefined, onLongSilence });
    const pushAndDrain = async (count: number, amp: number) => {
      for (let i = 0; i < count; i += 1) segmenter.pushFrame(makeFrame(amp));
      await segmenter.attachVad(scorer);
    };

    // Silence before any segment is emitted does not trigger onLongSilence.
    await pushAndDrain(90, 0.001);
    expect(onLongSilence).not.toHaveBeenCalled();

    // Emit one natural segment (8 redemption frames), then 74 idle frames (79 total shy of 8 s) -> not fired.
    await pushAndDrain(3, 0.3);
    await pushAndDrain(8 + 74, 0.001);
    expect(onLongSilence).not.toHaveBeenCalled();

    // 75th idle frame (83 total = ~8.0 s silence after speech) triggers once; further frames do not re-fire.
    await pushAndDrain(20, 0.001);
    expect(onLongSilence).toHaveBeenCalledTimes(1);

    // Another emitted segment re-arms onLongSilence.
    await pushAndDrain(3, 0.3);
    await pushAndDrain(8 + 75, 0.001);
    expect(onLongSilence).toHaveBeenCalledTimes(2);

    // flush() resets the idle-silence trigger until a new post-flush segment is emitted.
    await segmenter.flush();
    await pushAndDrain(90, 0.001);
    expect(onLongSilence).toHaveBeenCalledTimes(2);
  });

  it('continues segment indices and enforces cap from initialSegmentIndex and initialActiveFrames', async () => {
    const segments: DictationSegment[] = [];
    const onCapReached = vi.fn();
    const segmenter = new DictationSegmenter({
      onSegment: (seg) => segments.push(seg),
      onCapReached,
      initialSegmentIndex: 3,
      initialActiveFrames: 20,
      maxActiveFrames: 32,
    });
    await segmenter.attachVad({
      score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
    });

    const positions: Array<number | null> = [];
    // Push 4 speech + 8 quiet = 12 frames -> reaches maxActiveFrames (20 + 12 = 32) on the 12th frame.
    for (let i = 0; i < 4; i += 1) positions.push(segmenter.pushFrame(makeFrame(0.3)));
    for (let i = 0; i < 8; i += 1) positions.push(segmenter.pushFrame(makeFrame(0.001)));
    // Further frames past the cap are ignored and return null.
    positions.push(segmenter.pushFrame(makeFrame(0.3)));
    await segmenter.flush();

    expect(positions.slice(0, 12)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    expect(positions[12]).toBeNull();
    expect(onCapReached).toHaveBeenCalledTimes(1);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.index).toBe(3);
    expect(segments[0]?.wavBuffer?.byteLength).toBe(segments[0]?.wav.size);

    // Already at cap on construction rejects frames immediately.
    const capped = new DictationSegmenter({
      onSegment: () => undefined,
      initialActiveFrames: 10,
      maxActiveFrames: 10,
    });
    expect(capped.pushFrame(makeFrame(0.3))).toBeNull();
  });

  it('tracks consumedThroughFramePos across pending frames, preSpeechPad, and hard-cut overlap', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({ onSegment: (seg) => segments.push(seg) });

    // Before VAD attaches, frames stay pending at position 0.
    for (let i = 0; i < 6; i += 1) segmenter.pushFrame(makeFrame(0.001));
    expect(segmenter.getUnconsumedStartFramePos()).toBe(0);

    // After scoring 6 quiet frames, only the 4 preSpeechPad frames [2..5] remain needed.
    await segmenter.attachVad({
      score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
    });
    expect(segmenter.getUnconsumedStartFramePos()).toBe(2);

    // Natural cut at frame 17 while unscored frames 18..20 are still queued in pendingFrames:
    // consumedThroughFramePos must be 18 so tail frames 18..20 are NOT deleted.
    for (let i = 0; i < 4; i += 1) segmenter.pushFrame(makeFrame(0.3)); // pos 6..9
    for (let i = 0; i < 8; i += 1) segmenter.pushFrame(makeFrame(0.001)); // pos 10..17
    for (let i = 0; i < 3; i += 1) segmenter.pushFrame(makeFrame(0.3)); // pos 18..20
    await segmenter.flush();

    expect(segments).toHaveLength(2);
    expect(segments[0]?.cutReason).toBe('natural');
    expect(segments[0]?.consumedThroughFramePos).toBe(18);
    expect(segments[1]?.cutReason).toBe('flush');
    expect(segments[1]?.consumedThroughFramePos).toBe(21);

    // Hard cut at 25 s (260 frames) with best quiet frame at local index 254 (5 frames before end):
    // 6-frame overlap starts at local index 249, preserving both overlap and post-cut frames.
    const hardSegments: DictationSegment[] = [];
    const probs: number[] = [];
    const hardFrames: Float32Array[] = [];
    for (let i = 0; i < 260; i += 1) {
      hardFrames.push(makeFrame(i === 254 ? 0.05 : 0.25));
      probs.push(i === 254 ? 0.36 : 0.9);
    }
    let idx = 0;
    const hardSeg = new DictationSegmenter({
      onSegment: (seg) => hardSegments.push(seg),
      initialActiveFrames: 100,
    });
    await hardSeg.attachVad({ score: async () => probs[idx++] ?? 0.9 });
    for (const frame of hardFrames) hardSeg.pushFrame(frame);
    // Drain without flush yet so we inspect post-hard-cut unconsumed boundary.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(hardSegments).toHaveLength(1);
    expect(hardSegments[0]?.cutReason).toBe('hard');
    // Local index 249 corresponds to absolute frame position 100 + 249 = 349.
    expect(hardSegments[0]?.consumedThroughFramePos).toBe(349);
    expect(hardSeg.getUnconsumedStartFramePos()).toBe(349);

    // Flushing emits the overlapped continuation segment starting from those retained frames.
    await hardSeg.flush();
    expect(hardSegments).toHaveLength(2);
    expect(hardSegments[1]?.overlapped).toBe(true);
    expect(hardSegments[1]?.consumedThroughFramePos).toBe(360);
  });

  it('round-trips float PCM frames through encodePcm16Frames and decodePcm16Frames', () => {
    const f0 = makeFrame(0.3);
    const f1 = makeFrame(0.05);
    const decoded = decodePcm16Frames(encodePcm16Frames([f0, f1]));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.length).toBe(DICTATION_FRAME_SAMPLES);
    expect(decoded[1]?.length).toBe(DICTATION_FRAME_SAMPLES);
    expect(decoded[0]?.[10]).toBeCloseTo(f0[10]!, 3);
    expect(decoded[1]?.[10]).toBeCloseTo(f1[10]!, 3);
  });

  it('marks only the first replayed segment overlapped when initialOverlapped is true, deduplicating boundary words', async () => {
    const segments: DictationSegment[] = [];
    const segmenter = new DictationSegmenter({
      onSegment: (seg) => segments.push(seg),
      initialSegmentIndex: 1,
      initialOverlapped: true,
    });
    await segmenter.attachVad({
      score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
    });

    // First replayed utterance after a hard cut (followed by natural pause) -> overlapped: true.
    for (let i = 0; i < 4; i += 1) segmenter.pushFrame(makeFrame(0.3));
    for (let i = 0; i < 8; i += 1) segmenter.pushFrame(makeFrame(0.001));
    // Second utterance in the same replay -> overlapped: false.
    for (let i = 0; i < 4; i += 1) segmenter.pushFrame(makeFrame(0.3));
    await segmenter.flush();

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ index: 1, overlapped: true });
    expect(segments[1]).toMatchObject({ index: 2, overlapped: false });

    const stitched = stitchTranscript([
      { text: 'please invite Sam', overlapped: false },
      { text: 'Sam tomorrow', overlapped: segments[0]!.overlapped },
      { text: 'tomorrow morning', overlapped: segments[1]!.overlapped },
    ]);
    expect(stitched).toBe('please invite Sam tomorrow tomorrow morning');
  });
});
