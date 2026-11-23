/** Target dictation audio format expected by `/api/dictation/v1/transcribe`. */
export const DICTATION_SAMPLE_RATE = 16_000;
/** Silero VAD legacy frame size: 1536 samples = 96 ms at 16 kHz. */
export const DICTATION_FRAME_SAMPLES = 1_536;
export const DICTATION_MAX_SEGMENT_BYTES = 1_000_000;

const FRAME_MS = (DICTATION_FRAME_SAMPLES / DICTATION_SAMPLE_RATE) * 1000;
const MAX_ACTIVE_FRAMES = Math.floor((5 * 60 * 1000) / FRAME_MS);

const POSITIVE_SPEECH_THRESHOLD = 0.5;
const NEGATIVE_SPEECH_THRESHOLD = 0.35;
const PRE_SPEECH_PAD_FRAMES = 4;
const REDEMPTION_FRAMES = 8;
const SOFT_CUT_FRAMES = Math.round(15_000 / FRAME_MS);
const SOFT_CUT_QUIET_FRAMES = 2;
const HARD_CUT_FRAMES = Math.round(25_000 / FRAME_MS);
const HARD_CUT_SEARCH_FRAMES = Math.round(1_000 / FRAME_MS);
const HARD_CUT_OVERLAP_FRAMES = 6;
/** Minimum voiced frames (~192 ms) accepted on both natural pauses and Finish. */
const MIN_SPEECH_FRAMES = 2;
const SILENCE_RMS_FLOOR = 0.004;
const FALLBACK_RMS_THRESHOLD = 0.015;

export type DictationSegment = {
  index: number;
  wav: Blob;
  seconds: number;
  overlapped: boolean;
};

export type VadScorer = {
  score: (frame: Float32Array) => Promise<number>;
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

/** Computes root-mean-square amplitude for a PCM float frame in [-1, 1]. */
const computeFrameRms = (frame: Float32Array): number => {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const sample = frame[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
};

/** Energy-based fallback scorer used when Silero VAD fails to load or on early Finish. */
const rmsFallbackScorer: VadScorer = {
  score: (frame) => Promise.resolve(computeFrameRms(frame) >= FALLBACK_RMS_THRESHOLD ? 1 : 0),
};

/** Encodes 16 kHz mono float PCM frames into a standard 16-bit PCM WAV Blob. */
export const encodePcm16Wav = (
  frames: readonly Float32Array[],
  sampleRate = DICTATION_SAMPLE_RATE
): Blob => {
  let totalSamples = 0;
  for (const frame of frames) totalSamples += frame.length;

  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, frame[i] ?? 0));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

/**
 * Segments 16 kHz mono dictation PCM frames into WAV chunks <= 25 s using a single VAD state
 * machine. Buffers frames from t=0 until Silero VAD attaches (or switches to the RMS fallback
 * scorer on load failure / early Finish) so the opening syllable is never clipped.
 */
export class DictationSegmenter {
  private readonly onSegment: (segment: DictationSegment) => void;
  private readonly onCapReached?: () => void;
  private readonly maxActiveFrames: number;

  private scorer: VadScorer | null = null;
  private pendingFrames: Float32Array[] = [];
  private drainPromise: Promise<void> | null = null;

  private preSpeechPad: ScoredFrame[] = [];
  private segmentFrames: ScoredFrame[] = [];
  private speaking = false;
  private quietFrames = 0;
  private nextSegmentOverlapped = false;

  private activeFrames = 0;
  private capReached = false;
  private segmentIndex = 0;
  private cleared = false;

  constructor(options: DictationSegmenterOptions) {
    this.onSegment = options.onSegment;
    this.onCapReached = options.onCapReached;
    this.maxActiveFrames = options.maxActiveFrames ?? MAX_ACTIVE_FRAMES;
  }

  pushFrame(frame: Float32Array): void {
    if (this.cleared || this.capReached) return;

    this.activeFrames += 1;
    if (this.activeFrames >= this.maxActiveFrames) {
      this.capReached = true;
      this.onCapReached?.();
    }

    this.pendingFrames.push(frame);
    if (this.scorer) void this.scheduleDrain();
  }

  attachVad(scorer: VadScorer): Promise<void> {
    if (this.cleared) return Promise.resolve();
    this.scorer = scorer;
    return this.scheduleDrain();
  }

  markVadFailed(): Promise<void> {
    if (this.cleared) return Promise.resolve();
    if (!this.scorer) this.scorer = rmsFallbackScorer;
    return this.scheduleDrain();
  }

  /** Drains buffered frames (using the RMS fallback if VAD is not ready) and emits any tail. */
  async flush(): Promise<void> {
    if (this.cleared) return;
    if (!this.scorer) this.scorer = rmsFallbackScorer;
    await this.scheduleDrain();
    if (this.cleared) return;

    if (this.speaking && this.segmentFrames.length > 0) {
      this.emitSegment(this.segmentFrames, this.nextSegmentOverlapped);
    }
    this.resetState();
  }

  clear(): void {
    this.cleared = true;
    this.scorer = null;
    this.pendingFrames = [];
    this.resetState();
  }

  private scheduleDrain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.drainLoop().finally(() => {
      this.drainPromise = null;
    });
    return this.drainPromise;
  }

  private async drainLoop(): Promise<void> {
    while (!this.cleared && this.scorer && this.pendingFrames.length > 0) {
      const frame = this.pendingFrames.shift();
      if (!frame) break;
      const rms = computeFrameRms(frame);
      let prob: number;
      try {
        prob = await this.scorer.score(frame);
      } catch {
        this.scorer = rmsFallbackScorer;
        prob = await this.scorer.score(frame);
      }
      if (this.cleared) return;
      this.consumeScoredFrame({ frame, prob, rms });
    }
  }

  private resetState(): void {
    this.preSpeechPad = [];
    this.segmentFrames = [];
    this.speaking = false;
    this.quietFrames = 0;
    this.nextSegmentOverlapped = false;
  }

  private consumeScoredFrame(item: ScoredFrame): void {
    if (!this.speaking) {
      if (item.prob >= POSITIVE_SPEECH_THRESHOLD) {
        this.speaking = true;
        this.segmentFrames = [...this.preSpeechPad, item];
        this.preSpeechPad = [];
        this.quietFrames = 0;
      } else {
        this.preSpeechPad.push(item);
        if (this.preSpeechPad.length > PRE_SPEECH_PAD_FRAMES) this.preSpeechPad.shift();
      }
      return;
    }

    this.segmentFrames.push(item);
    this.quietFrames = item.prob < NEGATIVE_SPEECH_THRESHOLD ? this.quietFrames + 1 : 0;

    if (this.quietFrames >= REDEMPTION_FRAMES) {
      this.emitSegment(this.segmentFrames, this.nextSegmentOverlapped);
      this.resetState();
      return;
    }

    if (this.segmentFrames.length >= SOFT_CUT_FRAMES && this.quietFrames >= SOFT_CUT_QUIET_FRAMES) {
      this.emitSegment(this.segmentFrames, this.nextSegmentOverlapped);
      this.resetState();
      return;
    }

    if (this.segmentFrames.length >= HARD_CUT_FRAMES) {
      this.hardCut();
    }
  }

  private hardCut(): void {
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

    this.emitSegment(frames.slice(0, cutIndex + 1), this.nextSegmentOverlapped);

    const overlapStart = Math.max(0, cutIndex + 1 - HARD_CUT_OVERLAP_FRAMES);
    this.segmentFrames = frames.slice(overlapStart);
    this.nextSegmentOverlapped = true;
    this.speaking = true;

    let quiet = 0;
    for (let i = this.segmentFrames.length - 1; i >= 0; i -= 1) {
      if ((this.segmentFrames[i]?.prob ?? 1) < NEGATIVE_SPEECH_THRESHOLD) quiet += 1;
      else break;
    }
    this.quietFrames = quiet;
  }

  private emitSegment(frames: readonly ScoredFrame[], overlapped: boolean): void {
    let maxProb = 0;
    let peakRms = 0;
    let voicedFrames = 0;
    let totalSamples = 0;
    const rawFrames: Float32Array[] = [];

    for (const item of frames) {
      if (item.prob > maxProb) maxProb = item.prob;
      if (item.rms > peakRms) peakRms = item.rms;
      if (item.prob >= NEGATIVE_SPEECH_THRESHOLD && item.rms >= SILENCE_RMS_FLOOR) {
        voicedFrames += 1;
      }
      totalSamples += item.frame.length;
      rawFrames.push(item.frame);
    }

    if (maxProb < POSITIVE_SPEECH_THRESHOLD || peakRms < SILENCE_RMS_FLOOR) return;
    if (voicedFrames < MIN_SPEECH_FRAMES) return;

    const seconds = totalSamples / DICTATION_SAMPLE_RATE;
    if (seconds <= 0) return;

    const segment: DictationSegment = {
      index: this.segmentIndex,
      wav: encodePcm16Wav(rawFrames, DICTATION_SAMPLE_RATE),
      seconds,
      overlapped,
    };
    this.segmentIndex += 1;
    this.onSegment(segment);
  }
}
