import { describe, expect, it } from 'vitest';
import {
  buildMergedGroupWav,
  canAffordRefinement,
  chooseGroupSplitIndex,
  computeSegmentSliceFrames,
  estimateMergedGroupSeconds,
  REFINEMENT_MAX_AUDIO_SECONDS_PER_MINUTE,
  REFINEMENT_MAX_REQUESTS_PER_MINUTE,
  REFINEMENT_RATE_WINDOW_MS,
  selectNextUpload,
  stitchRefinedSegments,
  type DictationUploadSample,
  type RefinementGroup,
  type StitchableSegmentRecord,
} from './dictationRefinement';
import {
  DICTATION_FRAME_SAMPLES,
  DICTATION_SAMPLE_RATE,
  DICTATION_WAV_HEADER_BYTES,
  encodePcm16Wav,
  type DictationSegment,
} from './dictationSegmenter';

const FRAME_BYTES = DICTATION_FRAME_SAMPLES * 2;

const makeTaggedFrame = (tag: number): Float32Array => {
  const frame = new Float32Array(DICTATION_FRAME_SAMPLES);
  frame.fill(tag);
  return frame;
};

const makeSegment = (opts: {
  leading?: number;
  voiced: number;
  trailing?: number;
  overlapped?: boolean;
  pauseBeforeMs?: number;
  voicedTag?: number;
  quietTag?: number;
}): DictationSegment => {
  const leading = opts.leading ?? 4;
  const trailing = opts.trailing ?? 8;
  const voicedTag = opts.voicedTag ?? 0.5;
  const quietTag = opts.quietTag ?? 0.01;
  const frames: Float32Array[] = [
    ...Array.from({ length: leading }, () => makeTaggedFrame(quietTag)),
    ...Array.from({ length: opts.voiced }, () => makeTaggedFrame(voicedTag)),
    ...Array.from({ length: trailing }, () => makeTaggedFrame(quietTag)),
  ];
  return {
    index: 0,
    wav: encodePcm16Wav(frames, DICTATION_SAMPLE_RATE),
    seconds: (frames.length * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE,
    overlapped: opts.overlapped ?? false,
    cutReason: 'natural',
    leadingQuietFrames: leading,
    trailingQuietFrames: trailing,
    pauseBeforeMs: opts.pauseBeforeMs ?? 1_000,
  };
};

const readFrameFirstSamples = async (wav: Blob): Promise<number[]> => {
  const buf = await wav.arrayBuffer();
  const view = new DataView(buf);
  const frameCount = (buf.byteLength - DICTATION_WAV_HEADER_BYTES) / FRAME_BYTES;
  const samples: number[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    samples.push(view.getInt16(DICTATION_WAV_HEADER_BYTES + i * FRAME_BYTES, true));
  }
  return samples;
};

describe('dictationRefinement', () => {
  it('slices capped quiet edges without trimming voiced frames and preserves overlap leading frames', () => {
    const natural = makeSegment({ leading: 4, voiced: 5, trailing: 8 });
    expect(computeSegmentSliceFrames(natural, 'first')).toEqual({
      startFrame: 1,
      endFrame: 10,
      keptLeading: 3,
      keptTrailing: 1,
    });
    expect(computeSegmentSliceFrames(natural, 'middle')).toEqual({
      startFrame: 2,
      endFrame: 10,
      keptLeading: 2,
      keptTrailing: 1,
    });
    expect(computeSegmentSliceFrames(natural, 'last')).toEqual({
      startFrame: 2,
      endFrame: 11,
      keptLeading: 2,
      keptTrailing: 2,
    });

    // Hard-cut overlapped first segment preserves ALL leading frames (including overlap).
    const overlapped = makeSegment({ leading: 6, voiced: 5, trailing: 8, overlapped: true });
    expect(computeSegmentSliceFrames(overlapped, 'first')).toEqual({
      startFrame: 0,
      endFrame: 12,
      keptLeading: 6,
      keptTrailing: 1,
    });

    // Zero quiet edges never trim into voiced frames.
    const flushCut = makeSegment({ leading: 0, voiced: 3, trailing: 0 });
    expect(computeSegmentSliceFrames(flushCut, 'middle')).toEqual({
      startFrame: 0,
      endFrame: 3,
      keptLeading: 0,
      keptTrailing: 0,
    });
  });

  it('builds a valid merged WAV with 288 ms internal gaps, zero-padding flush cuts, and rejects oversized groups', async () => {
    const seg0 = makeSegment({
      leading: 4,
      voiced: 3,
      trailing: 8,
      voicedTag: 0.5,
      quietTag: 0.02,
    });
    const seg1 = makeSegment({
      leading: 4,
      voiced: 2,
      trailing: 8,
      voicedTag: 0.25,
      quietTag: 0.02,
    });
    const merged = buildMergedGroupWav([seg0, seg1]);
    expect(merged).not.toBeNull();
    // seg0: 3 lead + 3 voiced + 1 trail = 7; seg1: 2 lead + 2 voiced + 2 trail = 6 -> 13 frames total.
    expect(merged!.seconds).toBeCloseTo((13 * DICTATION_FRAME_SAMPLES) / DICTATION_SAMPLE_RATE, 5);
    expect(merged!.seconds).toBeCloseTo(estimateMergedGroupSeconds([seg0, seg1]), 5);

    const buf = await merged!.wav.arrayBuffer();
    const view = new DataView(buf);
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, offset, len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(13 * FRAME_BYTES);
    expect(buf.byteLength).toBe(DICTATION_WAV_HEADER_BYTES + 13 * FRAME_BYTES);

    const frameSamples = await readFrameFirstSamples(merged!.wav);
    expect(frameSamples).toHaveLength(13);
    // Voiced frames of seg0 (indices 3..5) and seg1 (indices 9..10) are separated by 3 quiet frames (indices 6..8).
    expect(frameSamples[3]).toBeGreaterThan(10_000);
    expect(frameSamples[5]).toBeGreaterThan(10_000);
    expect(frameSamples[6]).toBeLessThan(1_000);
    expect(frameSamples[7]).toBeLessThan(1_000);
    expect(frameSamples[8]).toBeLessThan(1_000);
    expect(frameSamples[9]).toBeGreaterThan(5_000);

    // Flush cut (0 trailing) + immediate onset (0 leading) gets padded with 3 zero frames (288 ms).
    const flush0 = makeSegment({ leading: 0, voiced: 2, trailing: 0, voicedTag: 0.5 });
    const flush1 = makeSegment({ leading: 0, voiced: 2, trailing: 0, voicedTag: 0.25 });
    const padded = buildMergedGroupWav([flush0, flush1]);
    expect(padded).not.toBeNull();
    const paddedSamples = await readFrameFirstSamples(padded!.wav);
    expect(paddedSamples).toHaveLength(7); // 2 voiced + 3 zero pad + 2 voiced
    expect(paddedSamples.slice(2, 5)).toEqual([0, 0, 0]);

    // Rejects < 2 segments, > 22 s duration, > 1 MB payload, and non-frame-aligned WAV sizes.
    expect(buildMergedGroupWav([seg0])).toBeNull();
    const long12s = makeSegment({ leading: 0, voiced: 125, trailing: 0 });
    expect(buildMergedGroupWav([long12s, long12s])).toBeNull();
    const huge17s = makeSegment({ leading: 0, voiced: 180, trailing: 0 });
    expect(buildMergedGroupWav([huge17s, huge17s])).toBeNull();
    const partialFrameWav = new Blob(
      [new Uint8Array(DICTATION_WAV_HEADER_BYTES + FRAME_BYTES + 10)],
      { type: 'audio/wav' }
    );
    const malformed = { ...seg0, wav: partialFrameWav };
    expect(buildMergedGroupWav([seg0, malformed])).toBeNull();
    expect(estimateMergedGroupSeconds([seg0, malformed])).toBe(Infinity);
  });

  it('chooses split index at the longest pause once prefix >= 10 s, honoring Infinity and ties', () => {
    // 6 s each (62 voiced frames ~5.95 s). Prefix [0..1] ~12.2 s >= 10 s.
    const s0 = makeSegment({ leading: 2, voiced: 62, trailing: 2, pauseBeforeMs: Infinity });
    const s1 = makeSegment({ leading: 2, voiced: 62, trailing: 2, pauseBeforeMs: 900 });
    const s2 = makeSegment({ leading: 2, voiced: 62, trailing: 2, pauseBeforeMs: 3_500 });
    const s3 = makeSegment({ leading: 2, voiced: 32, trailing: 2, pauseBeforeMs: 900 });
    const next = makeSegment({ leading: 2, voiced: 45, trailing: 2, pauseBeforeMs: 900 });
    expect(chooseGroupSplitIndex([s0, s1, s2, s3], next)).toBe(2);

    // Infinity pause boundary beats any finite pause; ties break toward larger splitIdx (seal more).
    const s2Inf = makeSegment({ leading: 2, voiced: 62, trailing: 2, pauseBeforeMs: Infinity });
    const s3Tie = makeSegment({ leading: 2, voiced: 32, trailing: 2, pauseBeforeMs: 3_500 });
    expect(chooseGroupSplitIndex([s0, s1, s2Inf, s3Tie], next)).toBe(2);

    const s2Tie = makeSegment({ leading: 2, voiced: 62, trailing: 2, pauseBeforeMs: 2_000 });
    const s3Same = makeSegment({ leading: 2, voiced: 32, trailing: 2, pauseBeforeMs: 2_000 });
    expect(chooseGroupSplitIndex([s0, s1, s2Tie, s3Same], next)).toBe(3);

    // Falls back to openSegments.length when no candidate satisfies the 10 s prefix threshold.
    const shortA = makeSegment({ leading: 1, voiced: 40, trailing: 1, pauseBeforeMs: 1_000 });
    const shortB = makeSegment({ leading: 1, voiced: 40, trailing: 1, pauseBeforeMs: 4_000 });
    const longNext = makeSegment({ leading: 1, voiced: 160, trailing: 1, pauseBeforeMs: 1_000 });
    expect(chooseGroupSplitIndex([shortA, shortB], longNext)).toBe(2);
  });

  it('enforces 24 RPM and 150 s/min rolling-window budget and prunes expired entries', () => {
    const history: DictationUploadSample[] = Array.from(
      { length: REFINEMENT_MAX_REQUESTS_PER_MINUTE },
      (_, i) => ({ atMs: 1_000 + i * 100, seconds: 1 })
    );
    expect(canAffordRefinement(history, 10_000, 2)).toBe(false);

    // Advancing past the 60 s window prunes expired entries and restores capacity.
    expect(canAffordRefinement(history, 1_000 + REFINEMENT_RATE_WINDOW_MS + 1, 2)).toBe(true);
    expect(history.length).toBeLessThan(REFINEMENT_MAX_REQUESTS_PER_MINUTE);

    // Enforces 150 s/min audio-seconds cap even when request count is small.
    const audioHeavy: DictationUploadSample[] = [
      { atMs: 10_000, seconds: REFINEMENT_MAX_AUDIO_SECONDS_PER_MINUTE - 5 },
    ];
    expect(canAffordRefinement(audioHeavy, 20_000, 6)).toBe(false);
    expect(canAffordRefinement(audioHeavy, 20_000, 5)).toBe(true);
  });

  it('stitches refined groups atomically, falls back to primaries, respects limit, and preserves overlap', () => {
    const records: StitchableSegmentRecord[] = [
      {
        segment: { overlapped: false },
        status: 'completed',
        text: 'Hard cut ends with alpha beta',
      },
      { segment: { overlapped: true }, status: 'completed', text: 'alpha beta clause one.' },
      { segment: { overlapped: false }, status: 'completed', text: 'Clause two.' },
      { segment: { overlapped: false }, status: 'completed', text: 'Tail clause.' },
    ];
    const groups: RefinementGroup[] = [
      { startIndex: 0, endIndex: 0, state: 'fallback' },
      {
        startIndex: 1,
        endIndex: 2,
        state: 'refined',
        refinedText: 'alpha beta clause one and clause two.',
      },
      { startIndex: 3, endIndex: 3, state: 'open' },
    ];

    // Full stitch replaces [1..2] atomically and deduplicates hard-cut overlap against record 0.
    expect(stitchRefinedSegments(records, groups)).toBe(
      'Hard cut ends with alpha beta clause one and clause two. Tail clause.'
    );

    // Limit = 3 (prompt for record 3) includes refined group [1..2] but excludes record 3.
    expect(stitchRefinedSegments(records, groups, 3)).toBe(
      'Hard cut ends with alpha beta clause one and clause two.'
    );

    // Limit = 2 stops inside group [1..2] so it falls back to completed primary 1 instead of peeking ahead.
    expect(stitchRefinedSegments(records, groups, 2)).toBe(
      'Hard cut ends with alpha beta clause one.'
    );

    // Uploading / fallback group displays completed primaries cleanly.
    const uploadingGroups: RefinementGroup[] = [
      groups[0]!,
      { ...groups[1]!, state: 'uploading' },
      groups[2]!,
    ];
    expect(stitchRefinedSegments(records, uploadingGroups)).toBe(
      'Hard cut ends with alpha beta clause one. Clause two. Tail clause.'
    );
  });

  it('selects uploads chronologically so fallen-back earlier primaries precede later refinements', () => {
    const records: Array<Pick<StitchableSegmentRecord, 'status'>> = [
      { status: 'completed' },
      { status: 'queued' },
      { status: 'completed' },
      { status: 'queued' },
    ];
    const groups: RefinementGroup[] = [
      { startIndex: 0, endIndex: 1, state: 'fallback' },
      { startIndex: 2, endIndex: 3, state: 'queued' },
    ];
    // Earlier fallen-back primary (index 1) runs before later queued refinement (startIndex 2).
    expect(selectNextUpload(records, groups)).toEqual({ kind: 'primary', index: 1 });

    // Once earlier primary completes, the refinement runs (skipping index 3 inside the queued group).
    records[1] = { status: 'completed' };
    expect(selectNextUpload(records, groups)).toEqual({ kind: 'refinement', group: groups[1] });

    // Tie-breaking favors refinement when group.startIndex <= open primary index (overflow prefix).
    const overflowGroups: RefinementGroup[] = [
      { startIndex: 0, endIndex: 1, state: 'queued' },
      { startIndex: 2, endIndex: 3, state: 'open' },
    ];
    expect(selectNextUpload(records, overflowGroups)).toEqual({
      kind: 'refinement',
      group: overflowGroups[0],
    });
  });
});
