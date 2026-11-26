import { loadImageElement, supportsWebpEncode } from '../dom';
import { getFileNameWithoutExt, getMimeTypeBase } from '../mimeTypes';
import { isEligibleImageForCompression } from './mediaCompressionEligibility';

export type CompressImageOptions = {
  maxLongEdge: number;
  quality: number;
  maxUploadSize?: number;
};

export type CompressedImageResult = {
  file: File;
  originalSize: number;
  compressedSize: number;
};

const PNG_HEADER_PROBE_BYTES = 64 * 1024;
const WEBP_HEADER_PROBE_BYTES = 64;
const SAVINGS_RATIO_THRESHOLD = 0.95;

const ALPHA_CAPABLE_MIMES = new Set(['image/png', 'image/webp']);

const OUTPUT_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const isAsciiLetter = (byte: number): boolean =>
  (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);

const readFourCC = (bytes: Uint8Array, offset: number): string | undefined => {
  if (offset + 4 > bytes.byteLength) return undefined;
  let text = '';
  for (let i = 0; i < 4; i += 1) {
    const code = bytes[offset + i];
    if (code === undefined || code < 0x20 || code > 0x7e) return undefined;
    text += String.fromCharCode(code);
  }
  return text;
};

const readPngChunkType = (bytes: Uint8Array, offset: number): string | undefined => {
  if (offset + 4 > bytes.byteLength) return undefined;
  let text = '';
  for (let i = 0; i < 4; i += 1) {
    const code = bytes[offset + i];
    if (code === undefined || !isAsciiLetter(code)) return undefined;
    text += String.fromCharCode(code);
  }
  return text;
};

/**
 * Returns true if the PNG carries an `acTL` chunk before `IDAT` (APNG) or if the PNG chunk header
 * structure is malformed or truncated before `IDAT`.
 */
const isApngOrMalformedPng = async (file: File): Promise<boolean> => {
  const bytes = new Uint8Array(await file.slice(0, PNG_HEADER_PROBE_BYTES).arrayBuffer());
  if (bytes.byteLength < PNG_SIGNATURE.length) return true;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return true;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    if (length > 0x7fffffff) return true;
    const type = readPngChunkType(bytes, offset + 4);
    if (!type) return true;
    if (offset === PNG_SIGNATURE.length && (type !== 'IHDR' || length !== 13)) return true;
    if (type === 'acTL') return true;
    if (type === 'IDAT') return offset + 12 + length > file.size;
    if (type === 'IEND') return true;

    const nextOffset = offset + 12 + length;
    if (nextOffset > bytes.byteLength) return true;
    offset = nextOffset;
  }
  return true;
};

/**
 * Returns true if the WebP header indicates animation (`VP8X` flag bit `0x02` or an `ANIM`/`ANMF`
 * chunk) or if the RIFF/WEBP container header is malformed or truncated.
 */
const isAnimatedOrMalformedWebp = async (file: File): Promise<boolean> => {
  const bytes = new Uint8Array(await file.slice(0, WEBP_HEADER_PROBE_BYTES).arrayBuffer());
  if (bytes.byteLength < 20) return true;
  if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') return true;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize < 12 || riffSize + 8 > file.size) return true;

  const firstType = readFourCC(bytes, 12);
  if (!firstType) return true;
  const firstSize = view.getUint32(16, true);
  if (20 + firstSize > file.size) return true;

  if (firstType === 'VP8 ' || firstType === 'VP8L') {
    return firstSize === 0;
  }
  if (firstType !== 'VP8X') return true;
  if (firstSize !== 10 || bytes.byteLength < 30 || file.size <= 30) return true;
  if (((bytes[20] ?? 0) & 0x02) !== 0) return true;

  let offset = 30;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = readFourCC(bytes, offset);
    if (!chunkType) return true;
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkType === 'ANIM' || chunkType === 'ANMF') return true;
    if (offset + 8 + chunkSize > file.size) return true;
    if (chunkType === 'VP8 ' || chunkType === 'VP8L') return false;
    offset += 8 + chunkSize + (chunkSize & 1);
  }
  return offset < file.size && offset + 8 > file.size;
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob | undefined> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), mimeType, quality);
  });

const hasTransparentPixel = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean => {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha !== undefined && alpha < 255) return true;
  }
  return false;
};

/**
 * Compresses a static raster image client-side via `<img>` -> `<canvas>`, preferring WebP when
 * supported and falling back to JPEG (opaque) or PNG (transparent) on WebKit/Safari. Returns
 * `undefined` when skipped, on any decode/encode failure, or when the savings guard rejects the
 * output.
 */
export const compressImage = async (
  file: File,
  options: CompressImageOptions
): Promise<CompressedImageResult | undefined> => {
  if (
    !isEligibleImageForCompression(file, options.maxUploadSize) ||
    !Number.isFinite(options.maxLongEdge) ||
    options.maxLongEdge <= 0
  ) {
    return undefined;
  }
  const mime = getMimeTypeBase(file.type);

  try {
    if (mime === 'image/png' && (await isApngOrMalformedPng(file))) return undefined;
    if (mime === 'image/webp' && (await isAnimatedOrMalformedWebp(file))) return undefined;
    if (typeof document === 'undefined') return undefined;

    const objectUrl = URL.createObjectURL(file);
    let canvas: HTMLCanvasElement | undefined;
    try {
      const img = await loadImageElement(objectUrl);
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      if (sourceWidth <= 0 || sourceHeight <= 0) return undefined;

      const scale = Math.min(1, options.maxLongEdge / Math.max(sourceWidth, sourceHeight));
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

      canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      let blob: Blob | undefined;
      if (supportsWebpEncode()) {
        const webpBlob = await canvasToBlob(canvas, 'image/webp', options.quality);
        if (webpBlob && getMimeTypeBase(webpBlob.type) === 'image/webp') {
          blob = webpBlob;
        }
      }

      if (!blob) {
        const hasAlpha =
          ALPHA_CAPABLE_MIMES.has(mime) && hasTransparentPixel(ctx, targetWidth, targetHeight);
        if (hasAlpha) {
          const pngBlob = await canvasToBlob(canvas, 'image/png');
          if (pngBlob && getMimeTypeBase(pngBlob.type) === 'image/png') {
            blob = pngBlob;
          }
        } else {
          const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', options.quality);
          if (jpegBlob && getMimeTypeBase(jpegBlob.type) === 'image/jpeg') {
            blob = jpegBlob;
          }
        }
      }

      if (!blob || blob.size <= 0) return undefined;

      const savesEnough = blob.size < file.size * SAVINGS_RATIO_THRESHOLD;
      const fixesOversize =
        options.maxUploadSize !== undefined &&
        file.size > options.maxUploadSize &&
        blob.size <= options.maxUploadSize;
      if (!savesEnough && !fixesOversize) return undefined;

      const outputMime = getMimeTypeBase(blob.type);
      const ext = OUTPUT_EXTENSIONS[outputMime];
      if (!ext) return undefined;

      const baseName = getFileNameWithoutExt(file.name) || 'image';
      const outputFile = new File([blob], `${baseName}.${ext}`, {
        type: outputMime,
        lastModified: file.lastModified,
      });

      return {
        file: outputFile,
        originalSize: file.size,
        compressedSize: outputFile.size,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } catch {
    return undefined;
  }
};
