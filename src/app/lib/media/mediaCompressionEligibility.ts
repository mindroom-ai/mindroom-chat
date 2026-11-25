import { getMimeTypeBase } from '../mimeTypes';

export const MIN_IMAGE_COMPRESSION_BYTES = 32 * 1024;
export const MIN_VIDEO_COMPRESSION_BYTES = 1024 * 1024;

export const SKIPPED_IMAGE_MIME_TYPES = new Set([
  'image/svg+xml',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/apng',
  'image/avif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/** Whether `file` is an image candidate for client-side compression. */
export const isEligibleImageForCompression = (file: File, maxUploadSize?: number): boolean => {
  const mime = getMimeTypeBase(file.type);
  if (!mime.startsWith('image/') || SKIPPED_IMAGE_MIME_TYPES.has(mime)) return false;
  if (file.size <= 0) return false;
  return (
    file.size >= MIN_IMAGE_COMPRESSION_BYTES ||
    (maxUploadSize !== undefined && file.size > maxUploadSize)
  );
};

/** Whether `file` is a video candidate for client-side WebCodecs compression. */
export const isEligibleVideoForCompression = (file: File, maxUploadSize?: number): boolean => {
  if (!getMimeTypeBase(file.type).startsWith('video/')) return false;
  if (file.size <= 0) return false;
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return false;
  return (
    file.size >= MIN_VIDEO_COMPRESSION_BYTES ||
    (maxUploadSize !== undefined && file.size > maxUploadSize)
  );
};
