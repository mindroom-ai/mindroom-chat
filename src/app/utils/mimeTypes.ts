export const FALLBACK_MIMETYPE = 'application/octet-stream';

/** Media types the client opens in the browser (as a blob URL) rather than only downloading. */






















  'text/plain',
];

/** The type without parameters, lower case: `Text/Plain; charset=utf-8` is `text/plain`. */
export const getMimeTypeBase = (mimeType: string): string =>
  mimeType.split(';')[0].trim().toLowerCase();

/** A type safe to give a blob URL; anything else is served as a download. */
export const getBlobSafeMimeType = (mimeType: string): string => {
  const base = getMimeTypeBase(mimeType);
  if (base === 'video/quicktime') return 'video/mp4';
  return ALLOWED_BLOB_MIMETYPES.includes(base) ? base : FALLBACK_MIMETYPE;
};

export const safeFile = (file: File): File => {
  const safeType = getBlobSafeMimeType(file.type);
  return safeType === file.type ? file : new File([file], file.name, { type: safeType });
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

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
};

export const mimeTypeToExt = (mimeType: string): string =>
  EXTENSIONS_BY_TYPE[getMimeTypeBase(mimeType)] ?? getMimeTypeBase(mimeType).split('/')[1] ?? '';
