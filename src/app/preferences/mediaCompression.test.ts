import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEDIA_COMPRESSION,
  MEDIA_COMPRESSION_PRESETS,
  getImageCompressionSpec,
  getVideoCompressionSpec,
  isMediaCompressionPreset,
} from './mediaCompression';

describe('mediaCompression preferences', () => {
  it('defaults to balanced and exposes presets in UI order', () => {
    expect(DEFAULT_MEDIA_COMPRESSION).toBe('balanced');
    expect(MEDIA_COMPRESSION_PRESETS).toEqual(['off', 'balanced', 'small']);
  });

  it('validates only known media compression presets', () => {
    for (const preset of MEDIA_COMPRESSION_PRESETS) {
      expect(isMediaCompressionPreset(preset), preset).toBe(true);
    }

    for (const invalid of [
      'Balanced',
      'OFF',
      'high',
      'medium',
      '',
      0,
      1,
      true,
      false,
      null,
      undefined,
      {},
    ]) {
      expect(isMediaCompressionPreset(invalid), String(invalid)).toBe(false);
    }
  });

  it('returns the expected image compression specs and isolates returned objects', () => {
    expect(getImageCompressionSpec('off')).toBeUndefined();
    expect(getImageCompressionSpec('balanced')).toEqual({ maxLongEdge: 2048, quality: 0.84 });
    expect(getImageCompressionSpec('small')).toEqual({ maxLongEdge: 1280, quality: 0.72 });

    const balanced = getImageCompressionSpec('balanced')!;
    const small = getImageCompressionSpec('small')!;
    expect(small.maxLongEdge).toBeLessThan(balanced.maxLongEdge);
    expect(small.quality).toBeLessThan(balanced.quality);

    balanced.maxLongEdge = 1;
    expect(getImageCompressionSpec('balanced')).toEqual({ maxLongEdge: 2048, quality: 0.84 });
  });

  it('returns the expected video compression specs and isolates returned objects', () => {
    expect(getVideoCompressionSpec('off')).toBeUndefined();
    expect(getVideoCompressionSpec('balanced')).toEqual({
      maxLongEdge: 1920,
      maxFps: 30,
      videoBitrate: 2_500_000,
    });
    expect(getVideoCompressionSpec('small')).toEqual({
      maxLongEdge: 1280,
      maxFps: 30,
      videoBitrate: 1_200_000,
    });

    const balanced = getVideoCompressionSpec('balanced')!;
    const small = getVideoCompressionSpec('small')!;
    expect(small.maxLongEdge).toBeLessThan(balanced.maxLongEdge);
    expect(small.videoBitrate).toBeLessThan(balanced.videoBitrate);
    expect(small.maxFps).toBeLessThanOrEqual(balanced.maxFps);

    balanced.videoBitrate = 1;
    expect(getVideoCompressionSpec('balanced')).toEqual({
      maxLongEdge: 1920,
      maxFps: 30,
      videoBitrate: 2_500_000,
    });
  });
});
