import { FALLBACK_MIMETYPE, getFileNameExt, getMimeTypeBase } from '../mimeTypes';

export const MIN_IMAGE_COMPRESSION_BYTES = 32 * 1024;
export const MIN_VIDEO_COMPRESSION_BYTES = 1024 * 1024;
export const MIN_AUTO_ZIP_FILE_BYTES = MIN_VIDEO_COMPRESSION_BYTES;
export const MAX_ZIP32_FILE_BYTES = 0xffffffff;

export const ELIGIBLE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALREADY_COMPRESSED_ARCHIVE_EXTENSIONS = new Set([
  'zip',
  'gz',
  'gzip',
  'tgz',
  'bz2',
  'xz',
  'zst',
  '7z',
  'rar',
  'lz4',
  'br',
]);

const ALREADY_COMPRESSED_ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/zstd',
  'application/x-zstd',
  'application/x-7z-compressed',
  'application/x-bzip2',
  'application/x-xz',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/brotli',
]);

/** Whether `file` is an image candidate for client-side compression. */
export const isEligibleImageForCompression = (file: File, maxUploadSize?: number): boolean => {
  const mime = getMimeTypeBase(file.type);
  if (!ELIGIBLE_IMAGE_MIME_TYPES.has(mime)) return false;
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

const MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'heic',
  'heif',
  'svg',
  'bmp',
  'ico',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'ogv',
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'opus',
  'flac',
  'aac',
  'weba',
]);

/** Whether an oversized `file` is eligible for client-side lossless `.zip` compression. */
export const canZipOversizedFile = (file: File): boolean => {
  if (file.size <= 0 || file.size >= MAX_ZIP32_FILE_BYTES) return false;
  if (typeof CompressionStream !== 'function') return false;
  if (ALREADY_COMPRESSED_ARCHIVE_MIME_TYPES.has(getMimeTypeBase(file.type))) return false;
  return !ALREADY_COMPRESSED_ARCHIVE_EXTENSIONS.has(getFileNameExt(file.name).toLowerCase());
};

/** Whether `file` is eligible for automatic client-side `.zip` compression before upload. */
export const isEligibleFileForAutoZip = (file: File): boolean => {
  if (!canZipOversizedFile(file) || file.size < MIN_AUTO_ZIP_FILE_BYTES) return false;
  const mime = getMimeTypeBase(file.type);
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) {
    return false;
  }
  if (mime === '' || mime === FALLBACK_MIMETYPE) {
    return !MEDIA_EXTENSIONS.has(getFileNameExt(file.name).toLowerCase());
  }
  return true;
};
