export const FALLBACK_MIMETYPE = 'application/octet-stream';

const subtypesOf = (type: 'audio' | 'image' | 'video', subtypes: string[]): string[] =>
  subtypes.map((subtype) => `${type}/${subtype}`);

// Media types the client gives to a blob URL for <img>, <video> or <audio>: the formats MDN
// lists as broadly supported by browsers ("Image file type and format guide" and "Media
// container formats", developer.mozilla.org/en-US/docs/Web/Media/Formats). Anything else,
// including SVG and HTML, which can run script, is served as a plain download.
const BLOB_SAFE_MIMETYPES = new Set([
  // Sorted per type. `x-m4a` and `x-wav` are what some systems report for .m4a and .wav files.
  ...subtypesOf('audio', ['aac', 'flac', 'mp4', 'mpeg', 'ogg', 'wav', 'webm', 'x-m4a', 'x-wav']),
  // `svg+xml` is left out on purpose: SVG can carry script.
  ...subtypesOf('image', ['apng', 'avif', 'bmp', 'gif', 'jpeg', 'png', 'webp']),
  // QuickTime is not listed; getBlobSafeMimeType maps it to MP4.
  ...subtypesOf('video', ['mp4', 'ogg', 'webm']),
]);

/** The type without parameters, lower case: `Text/Plain; charset=utf-8` is `text/plain`. */
export const getMimeTypeBase = (mimeType: string): string =>
  mimeType.split(';')[0].trim().toLowerCase();

/** A type safe to give a blob URL; anything else is served as a download. */
export const getBlobSafeMimeType = (mimeType: string): string => {
  const base = getMimeTypeBase(mimeType);
  // iPhones record QuickTime files; their H.264 content plays as MP4.
  if (base === 'video/quicktime') return 'video/mp4';
  return BLOB_SAFE_MIMETYPES.has(base) ? base : FALLBACK_MIMETYPE;
};

/** The name without its last extension: `report.final.pdf` is `report.final`. */
export const getFileNameWithoutExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

/** The extension without the dot, or an empty string. */
export const getFileNameExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1) : '';
};
