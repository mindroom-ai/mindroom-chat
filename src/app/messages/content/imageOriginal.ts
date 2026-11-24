import type { MatrixClient } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType, isHeicMimeType } from '../../lib/mimeTypes';

type ImageFile = {
  url: string;
  mimeType?: string;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
};

export type LoadedImageOriginal = {
  /** Blob URL the caller revokes once the picture leaves the screen. */
  src: string;
  /** Original attachment bytes to save when `src` is a converted copy (such as HEIC to JPEG). */
  downloadBlob?: Blob;
};

// Bounded LRU of converted HEIC display blobs so scrolling or opening the viewer skips re-decoding.
const MAX_CONVERTED_CACHE = 16;
const convertedCache = new Map<string, Blob>();
const inFlightConversions = new Map<string, Promise<Blob>>();

const readConvertedCache = (key: string): Blob | undefined => {
  const hit = convertedCache.get(key);
  if (!hit) return undefined;
  convertedCache.delete(key);
  convertedCache.set(key, hit);
  return hit;
};

const writeConvertedCache = (key: string, blob: Blob): void => {
  convertedCache.delete(key);
  convertedCache.set(key, blob);
  if (convertedCache.size > MAX_CONVERTED_CACHE) {
    const oldest = convertedCache.keys().next().value;
    if (oldest !== undefined) convertedCache.delete(oldest);
  }
};

const canDecodeNatively = async (blob: Blob): Promise<boolean> => {
  if (typeof createImageBitmap !== 'function') return false;
  try {
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
};

const convertHeicForDisplay = (blob: Blob, cacheKey: string): Promise<Blob> => {
  const cached = readConvertedCache(cacheKey);
  if (cached) return Promise.resolve(cached);
  const existing = inFlightConversions.get(cacheKey);
  if (existing) return existing;

  const work = (async () => {
    try {
      const { decodeHeicBlob } = await import('./heicDecode');
      const converted = await decodeHeicBlob(blob);
      writeConvertedCache(cacheKey, converted);
      return converted;
    } finally {
      inFlightConversions.delete(cacheKey);
    }
  })();
  inFlightConversions.set(cacheKey, work);
  return work;
};

/**
 * Turns a downloaded image blob into a display blob URL. HEIC/HEIF blobs are returned as-is when
 * the engine decodes them natively (Safari/WebKit), and lazily decoded otherwise.
 */
export const createDisplayableImageUrl = async (
  blob: Blob,
  mimeType: string,
  cacheKey: string
): Promise<LoadedImageOriginal> => {
  if (!isHeicMimeType(mimeType) && !isHeicMimeType(blob.type)) {
    return { src: URL.createObjectURL(blob) };
  }
  if (await canDecodeNatively(blob)) {
    return { src: URL.createObjectURL(blob) };
  }
  const converted = await convertHeicForDisplay(blob, cacheKey);
  return { src: URL.createObjectURL(converted), downloadBlob: blob };
};

/**
 * Loads an `m.image` attachment's original picture through the attachment cache, under the
 * event that owns it, and returns a displayable blob URL plus the original bytes when converted.
 */
export const loadImageOriginalForViewer = async (
  mx: MatrixClient,
  { url, mimeType, encInfo, owner }: ImageFile
): Promise<LoadedImageOriginal> => {
  // A type the browser would run (SVG) is loaded as plain bytes instead.
  const safeMimeType = getBlobSafeMimeType(mimeType ?? FALLBACK_MIMETYPE);
  const blob = await downloadCachedAttachment(mx, {
    owner,
    mxcUri: url,
    encryptedFile: encInfo ? { ...encInfo, url } : undefined,
    mimeType: safeMimeType,
  });
  const cacheKey = `${url}|${encInfo?.hashes?.sha256 ?? ''}`;
  return createDisplayableImageUrl(blob, safeMimeType, cacheKey);
};

/**
 * Loads an `m.image` attachment's original picture through the attachment cache, under the
 * event that owns it, and returns a blob URL the caller revokes.
 */
export const loadImageOriginal = async (mx: MatrixClient, file: ImageFile): Promise<string> =>
  (await loadImageOriginalForViewer(mx, file)).src;
