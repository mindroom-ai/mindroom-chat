export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_FRAME_SAMPLES = 1536;
export const DICTATION_FRAME_MS = (DICTATION_FRAME_SAMPLES / DICTATION_SAMPLE_RATE) * 1000;
export const DICTATION_MAX_SEGMENT_BYTES = 1_000_000;
export const DICTATION_MAX_ACTIVE_MS = 5 * 60 * 1000;
export const DICTATION_MAX_ACTIVE_FRAMES = Math.floor(DICTATION_MAX_ACTIVE_MS / DICTATION_FRAME_MS);

const PRE_SPEECH_PAD_FRAMES = 4;
const REDEMPTION_FRAMES = 8;
const SOFT_CUT_FRAMES = Math.ceil(15_000 / DICTATION_FRAME_MS);
const SOFT_CUT_QUIET_FRAMES = 2;
const HARD_CUT_FRAMES = Math.floor(25_000 / DICTATION_FRAME_MS);
const HARD_CUT_SEARCH_FRAMES = Math.round(1_000 / DICTATION_FRAME_MS);
const HARD_CUT_OVERLAP_FRAMES = 6;
const FALLBACK_SOFT_CUT_FRAMES = Math.ceil(20_000 / DICTATION_FRAME_MS);

const POSITIVE_SPEECH_THRESHOLD = 0.5;
const NEGATIVE_SPEECH_THRESHOLD = 0.35;
const MIN_SEGMENT_MS = 150;
const MIN_VOICED_FRAMES_NORMAL = 3;
const MIN_VOICED_FRAMES_FLUSH = 2;
const SILENCE_RMS_FLOOR = 0.001;
const FALLBACK_RMS_THRESHOLD = 0.015;

export type DictationSegment = {
  index: number;
  wav: Blob;
  seconds: number;
  overlapped: boolean;
  peakRms: number;
};

export type VadScorer = {
  score: (frame: Float32Array) => Promise<number>;
  reset?: () => void;
};

export type DictationSegmenterOptions = {
  onSegment: (segment: DictationSegment) => void;
  onCapReached?: () => void;
  maxActiveFrames?: number;
};

type ScoredFrame = {
  frame: Float32Array;
  prob: number;
  rms: number;
};

type RmsFrame = {
  frame: Float32Array;
  rms: number;
};

export const computeFrameRms = (frame: Float32Array): number => {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const sample = frame[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
};

const writeAscii = (view: DataView, offset: number, text: string): void => {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
};

/** Encodes 16 kHz mono Float32 PCM frames as a complete 16-bit PCM WAV Blob. */
export const encodePcm16Wav = (
  frames: readonly Float32Array[],
  sampleRate = DICTATION_SAMPLE_RATE
): Blob => {
  let totalSamples = 0;
  for (const frame of frames) totalSamples += frame.length;
  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, frame[i] ?? 0));
      view.setInt16(
        offset,
        clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff),
        true
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

/**
 * Buffers 16 kHz PCM frames from t=0 while Silero VAD loads, catches up over buffered frames
 * once VAD attaches, and falls back to RMS-based segmentation if VAD fails or Finish runs first.
 */
export class DictationSegmenter {
  private readonly onSegment: (segment: DictationSegment) => void;

  private readonly onCapReached?: () => void;

  private readonly maxActiveFrames: number;

  private mode: 'loading' | 'ready' | 'fallback' = 'loading';

  private vad?: VadScorer;

  private unscoredQueue: Float32Array[] = [];

  private drainPromise?: Promise<void>;

  private activeFrames = 0;

  private capNotified = false;

  private segmentIndex = 0;

  // VAD state machine
  private speaking = false;

  private preSpeechRing: ScoredFrame[] = [];

  private segmentFrames: ScoredFrame[] = [];

  private redemptionCount = 0;

  private lowProbStreak = 0;

  private nextSegmentOverlapped = false;

  // Fallback RMS state
  private fallbackFrames: RmsFrame[] = [];

  private fallbackQuietStreak = 0;

  private fallbackOverlapped = false;

  constructor(options: DictationSegmenterOptions) {
    this.onSegment = options.onSegment;
    this.onCapReached = options.onCapReached;
    this.maxActiveFrames = options.maxActiveFrames ?? DICTATION_MAX_ACTIVE_FRAMES;
  }

  get activeMs(): number {
    return this.activeFrames * DICTATION_FRAME_MS;
  }

  get isCapReached(): boolean {
    return this.activeFrames >= this.maxActiveFrames;
  }

  /** Accepts one 1536-sample 16 kHz mono frame. */
  pushFrame(frame: Float32Array): void {
    if (this.activeFrames >= this.maxActiveFrames) {
      if (!this.capNotified) {
        this.capNotified = true;
        this.onCapReached?.();
      }
      return;
    }
    this.activeFrames += 1;
    if (this.mode === 'fallback') {
      this.pushFallbackFrame(frame);
    } else {
      this.unscoredQueue.push(frame);
      if (this.mode === 'ready') void this.ensureDraining();
    }
    if (this.activeFrames >= this.maxActiveFrames && !this.capNotified) {
      this.capNotified = true;
      this.onCapReached?.();
    }
  }

  /** Attaches the loaded Silero VAD scorer and catches up over all t=0 buffered frames. */
  async attachVad(vad: VadScorer): Promise<void> {
    if (this.mode !== 'loading') return;
    this.vad = vad;
    this.mode = 'ready';
    await this.ensureDraining();
  }

  /** Switches permanently to RMS fallback and replays any frames buffered during loading. */
  markVadFailed(): void {
    if (this.mode === 'fallback') return;
    this.mode = 'fallback';
    this.vad = undefined;
    // Replay any partially collected VAD frames first so no audio is lost on mid-run failure.
    const carried = this.segmentFrames.map((item) => item.frame);
    this.resetVadState();
    const queued = this.unscoredQueue;
    this.unscoredQueue = [];
    for (const frame of carried) this.pushFallbackFrame(frame);
    for (const frame of queued) this.pushFallbackFrame(frame);
  }

  /** Flushes any in-progress speech segment on Pause or Finish. */
  async flush(reason: 'pause' | 'finish'): Promise<void> {
    if (this.mode === 'ready') {
      await this.ensureDraining();
      // ensureDraining can fall back if VAD threw during scoring.
      if (this.mode === 'ready') {
        if (this.speaking && this.segmentFrames.length > 0) {
          this.emitVadSegment(this.segmentFrames, this.nextSegmentOverlapped, true);
        }
        this.resetVadState();
        if (reason === 'pause') this.vad?.reset?.();
        return;
      }
    }

    if (this.mode === 'loading') {
      if (reason === 'finish') {
        this.markVadFailed();
      } else {
        // Pause while still loading: flush buffered PCM via fallback without blocking future VAD.
        const queued = this.unscoredQueue;
        this.unscoredQueue = [];
        for (const frame of queued) this.pushFallbackFrame(frame);
        this.flushFallback();
        return;
      }
    }

    this.flushFallback();
  }

  /** Clears all buffered audio without emitting segments. */
  clear(): void {
    this.unscoredQueue = [];
    this.resetVadState();
    this.fallbackFrames = [];
    this.fallbackQuietStreak = 0;
    this.fallbackOverlapped = false;
  }

  private resetVadState(): void {
    this.speaking = false;
    this.preSpeechRing = [];
    this.segmentFrames = [];
    this.redemptionCount = 0;
    this.lowProbStreak = 0;
    this.nextSegmentOverlapped = false;
  }

  private ensureDraining(): Promise<void> {
    if (!this.drainPromise) {
      this.drainPromise = this.drainQueue().finally(() => {
        this.drainPromise = undefined;
      });
    }
    return this.drainPromise;
  }

  private async drainQueue(): Promise<void> {
    while (this.mode === 'ready' && this.unscoredQueue.length > 0) {
      const frame = this.unscoredQueue.shift();
      if (!frame || !this.vad) break;
      try {
        const prob = await this.vad.score(frame);
        if (this.mode !== 'ready') return;
        this.processScoredFrame(frame, prob);
      } catch {
        // Put the unscored frame back at the front and switch cleanly to fallback.
        this.unscoredQueue.unshift(frame);
        this.markVadFailed();
        return;
      }
    }
  }

  private processScoredFrame(frame: Float32Array, prob: number): void {
    const rms = computeFrameRms(frame);
    const entry: ScoredFrame = { frame, prob, rms };

    if (!this.speaking) {
      if (prob >= POSITIVE_SPEECH_THRESHOLD && rms >= SILENCE_RMS_FLOOR) {
        this.speaking = true;
        this.segmentFrames = [...this.preSpeechRing, entry];
        this.preSpeechRing = [];
        this.redemptionCount = 0;
        this.lowProbStreak = 0;
      } else {
        this.preSpeechRing.push(entry);
        if (this.preSpeechRing.length > PRE_SPEECH_PAD_FRAMES) {
          this.preSpeechRing.shift();
        }
      }
      return;
    }

    this.segmentFrames.push(entry);
    if (prob < NEGATIVE_SPEECH_THRESHOLD) {
      this.lowProbStreak += 1;
      this.redemptionCount += 1;
    } else {
      this.lowProbStreak = 0;
      this.redemptionCount = 0;
    }

    if (this.redemptionCount >= REDEMPTION_FRAMES) {
      this.emitVadSegment(this.segmentFrames, this.nextSegmentOverlapped, false);
      this.resetVadState();
      return;
    }

    if (
      this.segmentFrames.length >= SOFT_CUT_FRAMES &&
      this.lowProbStreak >= SOFT_CUT_QUIET_FRAMES
    ) {
      this.emitVadSegment(this.segmentFrames, this.nextSegmentOverlapped, false);
      this.resetVadState();
      return;
    }

    if (this.segmentFrames.length >= HARD_CUT_FRAMES) {
      this.hardCutVad();
    }
  }

  private hardCutVad(): void {
    const frames = this.segmentFrames;
    const searchStart = Math.max(0, frames.length - HARD_CUT_SEARCH_FRAMES);
    let cutIndex = frames.length - 1;
    let bestProb = Infinity;
    let bestRms = Infinity;

    for (let i = searchStart; i < frames.length; i += 1) {
      const item = frames[i];
      if (!item) continue;
      if (
        item.prob < bestProb - 1e-4 ||
        (Math.abs(item.prob - bestProb) <= 1e-4 && item.rms < bestRms)
      ) {
        bestProb = item.prob;
        bestRms = item.rms;
        cutIndex = i;
      }
    }

    this.emitVadSegment(frames.slice(0, cutIndex + 1), this.nextSegmentOverlapped, false);

    const overlapStart = Math.max(0, cutIndex + 1 - HARD_CUT_OVERLAP_FRAMES);
    this.segmentFrames = frames.slice(overlapStart);
    this.nextSegmentOverlapped = true;
    this.speaking = true;

    // Recompute trailing quiet counters on the carried frames.
    let quiet = 0;
    for (let i = this.segmentFrames.length - 1; i >= 0; i -= 1) {
      if ((this.segmentFrames[i]?.prob ?? 1) < NEGATIVE_SPEECH_THRESHOLD) quiet += 1;
      else break;
    }
    this.lowProbStreak = quiet;
    this.redemptionCount = quiet;
  }

  private emitVadSegment(
    frames: readonly ScoredFrame[],
    overlapped: boolean,
    isFlush: boolean
  ): void {
    const durationMs = frames.length * DICTATION_FRAME_MS;
    if (durationMs < MIN_SEGMENT_MS) return;

    let maxProb = 0;
    let peakRms = 0;
    let voicedFrames = 0;
    for (const item of frames) {
      if (item.prob > maxProb) maxProb = item.prob;
      if (item.rms > peakRms) peakRms = item.rms;
      if (item.prob >= NEGATIVE_SPEECH_THRESHOLD && item.rms >= SILENCE_RMS_FLOOR) {
        voicedFrames += 1;
      }
    }

    if (maxProb < POSITIVE_SPEECH_THRESHOLD || peakRms < SILENCE_RMS_FLOOR) return;
    const minVoiced = isFlush ? MIN_VOICED_FRAMES_FLUSH : MIN_VOICED_FRAMES_NORMAL;
    if (voicedFrames < minVoiced) return;

    this.emitRawFrames(
      frames.map((item) => item.frame),
      overlapped,
      peakRms
    );
  }

  private pushFallbackFrame(frame: Float32Array): void {
    const rms = computeFrameRms(frame);
    this.fallbackFrames.push({ frame, rms });
    if (rms < FALLBACK_RMS_THRESHOLD * 1.5) {
      this.fallbackQuietStreak += 1;
    } else {
      this.fallbackQuietStreak = 0;
    }

    if (
      this.fallbackFrames.length >= FALLBACK_SOFT_CUT_FRAMES &&
      this.fallbackQuietStreak >= SOFT_CUT_QUIET_FRAMES
    ) {
      this.emitFallbackSegment(this.fallbackFrames, this.fallbackOverlapped);
      this.fallbackFrames = [];
      this.fallbackQuietStreak = 0;
      this.fallbackOverlapped = false;
      return;
    }

    if (this.fallbackFrames.length >= HARD_CUT_FRAMES) {
      this.hardCutFallback();
    }
  }

  private hardCutFallback(): void {
    const frames = this.fallbackFrames;
    const searchStart = Math.max(0, frames.length - HARD_CUT_SEARCH_FRAMES);
    let cutIndex = frames.length - 1;
    let bestRms = Infinity;
    for (let i = searchStart; i < frames.length; i += 1) {
      const item = frames[i];
      if (item && item.rms < bestRms) {
        bestRms = item.rms;
        cutIndex = i;
      }
    }

    this.emitFallbackSegment(frames.slice(0, cutIndex + 1), this.fallbackOverlapped);
    const overlapStart = Math.max(0, cutIndex + 1 - HARD_CUT_OVERLAP_FRAMES);
    this.fallbackFrames = frames.slice(overlapStart);
    this.fallbackOverlapped = true;
    this.fallbackQuietStreak = 0;
  }

  private flushFallback(): void {
    while (this.fallbackFrames.length > HARD_CUT_FRAMES) {
      this.hardCutFallback();
    }
    if (this.fallbackFrames.length > 0) {
      this.emitFallbackSegment(this.fallbackFrames, this.fallbackOverlapped);
    }
    this.fallbackFrames = [];
    this.fallbackQuietStreak = 0;
    this.fallbackOverlapped = false;
  }

  private emitFallbackSegment(frames: readonly RmsFrame[], overlapped: boolean): void {
    let firstVoiced = -1;
    let lastVoiced = -1;
    let voicedCount = 0;
    let peakRms = 0;

    for (let i = 0; i < frames.length; i += 1) {
      const rms = frames[i]?.rms ?? 0;
      if (rms > peakRms) peakRms = rms;
      if (rms >= FALLBACK_RMS_THRESHOLD) {
        if (firstVoiced === -1) firstVoiced = i;
        lastVoiced = i;
        voicedCount += 1;
      }
    }

    if (voicedCount < MIN_VOICED_FRAMES_FLUSH) return;
    const start = Math.max(0, firstVoiced - PRE_SPEECH_PAD_FRAMES);
    const end = Math.min(frames.length, lastVoiced + PRE_SPEECH_PAD_FRAMES + 1);
    const trimmed = frames.slice(start, end);
    if (trimmed.length * DICTATION_FRAME_MS < MIN_SEGMENT_MS) return;

    this.emitRawFrames(
      trimmed.map((item) => item.frame),
      overlapped,
      peakRms
    );
  }

  private emitRawFrames(
    frames: readonly Float32Array[],
    overlapped: boolean,
    peakRms: number
  ): void {
    let totalSamples = 0;
    for (const frame of frames) totalSamples += frame.length;
    const seconds = totalSamples / DICTATION_SAMPLE_RATE;
    if (seconds <= 0) return;

    const wav = encodePcm16Wav(frames, DICTATION_SAMPLE_RATE);
    const segment: DictationSegment = {
      index: this.segmentIndex,
      wav,
      seconds,
      overlapped,
      peakRms,
    };
    this.segmentIndex += 1;
    this.onSegment(segment);
  }
}
