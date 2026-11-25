import { describe, expect, it } from 'vitest';
import {
  AUDIO_ACTIVE_THRESHOLD,
  BAR_REST_SCALE,
  SPECTRUM_BANDS_HZ,
  SPECTRUM_BAR_COUNT,
  barScaleFromLevel,
  extractSpectrumBands,
  stepSpectrumBars,
} from './audioSpectrum';

const FFT_SIZE = 1024;
const toneBins = (freqHz: number, value: number, sampleRate = 48_000) => {
  const bins = new Uint8Array(FFT_SIZE / 2);
  const bin = Math.round((freqHz * FFT_SIZE) / sampleRate);
  if (bin >= 0 && bin < bins.length) bins[bin] = value;
  return bins;
};

describe('audioSpectrum', () => {
  it.each([
    [120, 0],
    [400, 1],
    [1000, 2],
    [2200, 3],
    [5000, 4],
  ])('maps %i Hz to peak bar %i with no artificial center-weighting', (freqHz, expectedBar) => {
    const out = new Float32Array(SPECTRUM_BAR_COUNT);
    extractSpectrumBands(toneBins(freqHz, 220), 48_000, FFT_SIZE, out);
    expect(out[expectedBar]).toBeGreaterThan(0.6);
    for (let i = 0; i < SPECTRUM_BAR_COUNT; i += 1) {
      if (i !== expectedBar) expect(out[i]).toBe(0);
    }
  });

  it('orders louder over softer, zeroes silence/noise floor, and handles 8kHz/16kHz/48kHz', () => {
    expect(SPECTRUM_BANDS_HZ).toHaveLength(SPECTRUM_BAR_COUNT);
    const quiet = new Float32Array(SPECTRUM_BAR_COUNT);
    const loud = new Float32Array(SPECTRUM_BAR_COUNT);
    extractSpectrumBands(toneBins(1000, 80), 48_000, FFT_SIZE, quiet);
    extractSpectrumBands(toneBins(1000, 220), 48_000, FFT_SIZE, loud);
    expect(loud[2]).toBeGreaterThan(quiet[2] ?? 0);

    const out = new Float32Array(SPECTRUM_BAR_COUNT).fill(1);
    extractSpectrumBands(new Uint8Array(FFT_SIZE / 2), 48_000, FFT_SIZE, out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);
    extractSpectrumBands(new Uint8Array(FFT_SIZE / 2).fill(4), 48_000, FFT_SIZE, out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);

    for (const [sampleRate, trebleHz] of [
      [8_000, 3_600],
      [16_000, 5_000],
      [48_000, 5_000],
    ] as const) {
      extractSpectrumBands(toneBins(120, 200, sampleRate), sampleRate, FFT_SIZE, out);
      expect(out[0]).toBeGreaterThan(0.5);
      expect(out[4]).toBe(0);
      extractSpectrumBands(toneBins(trebleHz, 200, sampleRate), sampleRate, FFT_SIZE, out);
      expect(out[4]).toBeGreaterThan(0.5);
      expect(out[0]).toBe(0);
    }
  });

  it('smooths with fast attack, slower decay, gentler reducedMotion, settle, and scale mapping', () => {
    const high = new Float32Array([1, 0, 0, 0, 0]);
    const zero = new Float32Array(SPECTRUM_BAR_COUNT);
    const up = new Float32Array(SPECTRUM_BAR_COUNT);
    const down = new Float32Array([1, 0, 0, 0, 0]);
    const reduced = new Float32Array(SPECTRUM_BAR_COUNT);

    expect(stepSpectrumBars(high, up, 30, false)).toBe(true);
    stepSpectrumBars(zero, down, 30, false);
    stepSpectrumBars(high, reduced, 30, true);
    expect(up[0]).toBeGreaterThan(1 - (down[0] ?? 1));
    expect(reduced[0]).toBeLessThan(up[0] ?? 0);

    const two = new Float32Array(SPECTRUM_BAR_COUNT);
    const one = new Float32Array(SPECTRUM_BAR_COUNT);
    stepSpectrumBars(high, two, 16, false);
    stepSpectrumBars(high, two, 16, false);
    stepSpectrumBars(high, one, 32, false);
    expect(two[0]).toBeCloseTo(one[0] ?? 0, 5);

    const tiny = new Float32Array([0.004, 0, 0, 0, 0]);
    expect(stepSpectrumBars(zero, tiny, 16, false)).toBe(false);
    expect(tiny[0]).toBe(0);
    const edge = new Float32Array([AUDIO_ACTIVE_THRESHOLD, 0, 0, 0, 0]);
    expect(stepSpectrumBars(edge, edge, 0, false)).toBe(false);

    expect(barScaleFromLevel(0)).toBe(BAR_REST_SCALE);
    expect(barScaleFromLevel(1)).toBe(1);
    expect(barScaleFromLevel(-1)).toBe(BAR_REST_SCALE);
    expect(barScaleFromLevel(2)).toBe(1);
  });
});
