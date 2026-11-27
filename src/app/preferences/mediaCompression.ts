/**
 * Client-side compression preset for attached images and videos (`lib/media/compressImage.ts`,
 * `lib/media/compressVideo.ts`). Its own file, so that `settings.ts` and `roamingSettings.ts`
 * both read it without importing each other.
 */
export const MEDIA_COMPRESSION_PRESETS = ['off', 'balanced', 'small'] as const;
export type MediaCompressionPreset = (typeof MEDIA_COMPRESSION_PRESETS)[number];
export const DEFAULT_MEDIA_COMPRESSION: MediaCompressionPreset = 'balanced';

export const isMediaCompressionPreset = (value: unknown): value is MediaCompressionPreset =>
  MEDIA_COMPRESSION_PRESETS.includes(value as MediaCompressionPreset);

export type ImageCompressionSpec = {
  maxLongEdge: number;
  quality: number;
};

export type VideoCompressionSpec = {
  maxLongEdge: number;
  maxFps: number;
  videoBitrate: number;
};

const IMAGE_COMPRESSION_SPECS: Record<
  Exclude<MediaCompressionPreset, 'off'>,
  ImageCompressionSpec
> = {
  balanced: { maxLongEdge: 2048, quality: 0.84 },
  small: { maxLongEdge: 1280, quality: 0.72 },
};

const VIDEO_COMPRESSION_SPECS: Record<
  Exclude<MediaCompressionPreset, 'off'>,
  VideoCompressionSpec
> = {
  balanced: { maxLongEdge: 1920, maxFps: 30, videoBitrate: 2_500_000 },
  small: { maxLongEdge: 1280, maxFps: 30, videoBitrate: 1_200_000 },
};

export const getImageCompressionSpec = (
  preset: MediaCompressionPreset
): ImageCompressionSpec | undefined =>
  preset === 'off' ? undefined : { ...IMAGE_COMPRESSION_SPECS[preset] };

export const getVideoCompressionSpec = (
  preset: MediaCompressionPreset
): VideoCompressionSpec | undefined =>
  preset === 'off' ? undefined : { ...VIDEO_COMPRESSION_SPECS[preset] };
