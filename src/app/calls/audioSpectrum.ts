/** Number of frequency-band bars rendered in the voice stage waveform. */
export const SPECTRUM_BAR_COUNT = 5;
/** Vertical scale of an idle bar so the waveform rests as five compact dots. */
export const BAR_REST_SCALE = 0.18;
/** Minimum smoothed bar level considered active audio for bar coloring. */
export const AUDIO_ACTIVE_THRESHOLD = 0.04;

/** Five logarithmic vocal/audio frequency bands in Hz, ordered left (bass) to right (treble). */
export const SPECTRUM_BANDS_HZ: readonly (readonly [number, number])[] = [
  [60, 250],
  [250, 600],
  [600, 1400],
  [1400, 3200],
  [3200, 8000],
] as const;

const NOISE_FLOOR = 0.02;
const SETTLE_EPSILON = 0.005;
const ATTACK_TAU_MS = 35;
const DECAY_TAU_MS = 140;
const REDUCED_ATTACK_TAU_MS = 120;
const REDUCED_DECAY_TAU_MS = 260;

/**
 * Extracts normalized [0, 1] energy for each frequency band from Web Audio byte FFT bins into
 * `out` with a peak + RMS blend and no artificial center-weighting.
 */
export function extractSpectrumBands(
  bins: Uint8Array,
  sampleRate: number,
  fftSize: number,
  out: Float32Array
): void {
  const bandCount = Math.min(SPECTRUM_BANDS_HZ.length, out.length);
  if (bins.length <= 1 || sampleRate <= 0 || fftSize <= 0) {
    out.fill(0, 0, bandCount);
    return;
  }

  const binHz = sampleRate / fftSize;
  const maxBin = bins.length - 1;
  for (let i = 0; i < bandCount; i += 1) {
    const band = SPECTRUM_BANDS_HZ[i];
    if (!band) continue;
    const [lowHz, highHz] = band;
    const rawStart = i === 0 ? Math.floor(lowHz / binHz) : Math.ceil(lowHz / binHz);
    const rawEnd =
      i === SPECTRUM_BANDS_HZ.length - 1
        ? Math.floor(highHz / binHz)
        : Math.ceil(highHz / binHz) - 1;
    const startBin = Math.max(1, Math.min(maxBin, rawStart));
    const endBin = Math.max(startBin, Math.min(maxBin, rawEnd));

    let max = 0;
    let sumSq = 0;
    for (let bin = startBin; bin <= endBin; bin += 1) {
      const value = (bins[bin] ?? 0) / 255;
      if (value > max) max = value;
      sumSq += value * value;
    }
    const level = 0.75 * max + 0.25 * Math.sqrt(sumSq / (endBin - startBin + 1));
    out[i] = level < NOISE_FLOOR ? 0 : Math.min(1, level);
  }
}

/**
 * Advances `current` toward `target` with frame-rate-independent exponential smoothing (fast
 * attack, smooth decay, calmer under `reducedMotion`), snapping tiny residuals to 0.
 * Returns whether any bar exceeds `AUDIO_ACTIVE_THRESHOLD`.
 */
export function stepSpectrumBars(
  target: Float32Array,
  current: Float32Array,
  dtMs: number,
  reducedMotion: boolean
): boolean {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const attackAlpha =
    dt === 0 ? 0 : 1 - Math.exp(-dt / (reducedMotion ? REDUCED_ATTACK_TAU_MS : ATTACK_TAU_MS));
  const decayAlpha =
    dt === 0 ? 0 : 1 - Math.exp(-dt / (reducedMotion ? REDUCED_DECAY_TAU_MS : DECAY_TAU_MS));
  const count = Math.min(SPECTRUM_BAR_COUNT, target.length, current.length);
  let active = false;
  for (let i = 0; i < count; i += 1) {
    const prev = current[i] ?? 0;
    const raw = target[i] ?? 0;
    const goal = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    const next = prev + (goal - prev) * (goal >= prev ? attackAlpha : decayAlpha);
    const settled = next < SETTLE_EPSILON ? 0 : next;
    current[i] = settled;
    if (settled > AUDIO_ACTIVE_THRESHOLD) active = true;
  }
  return active;
}

/** Maps a [0, 1] band level to its CSS `scaleY` factor in [BAR_REST_SCALE, 1]. */
export function barScaleFromLevel(level: number): number {
  const clamped = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  return BAR_REST_SCALE + clamped * (1 - BAR_REST_SCALE);
}
