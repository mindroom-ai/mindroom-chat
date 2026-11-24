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
  signal?: AbortSignal;
};

export type LoadedImageOriginal = {
  /** Blob URL the caller revokes once the picture leaves the screen. */
  src: string;
  /** Original attachment bytes to save when `src` is a converted copy (such as HEIC to JPEG). */
  downloadBlob?: Blob;
};

/** Max HEIC byte size decoded in JS; larger files fall back to the file row to download. */
export const MAX_HEIC_BYTES = 30 * 1024 * 1024;

/** A HEIC/HEIF picture could not be decoded or exceeded the decode size budget. */
export class HeicDecodeError extends Error {
  constructor(message: string, readonly originalBlob?: Blob, cause?: unknown) {
    super(message, { cause });
    this.name = 'HeicDecodeError';
  }
}

// Bounded LRU of in-flight and completed converted HEIC blobs; rejected entries are evicted.
const MAX_CONVERTED_CACHE = 16;
const convertedCache = new Map<string, Promise<Blob>>();
let nativeHeicSupported: boolean | undefined;

export const resetHeicDecodeStateForTests = (): void => {
  nativeHeicSupported = undefined;
  convertedCache.clear();
};

const canDecodeNatively = async (blob: Blob): Promise<boolean> => {
  if (nativeHeicSupported !== undefined) return nativeHeicSupported;
  if (typeof createImageBitmap !== 'function') return false;
  try {
    (await createImageBitmap(blob)).close();
    nativeHeicSupported = true;
    return true;
  } catch {
    return false;
  }
};

const convertHeicForDisplay = (blob: Blob, key: string, signal?: AbortSignal): Promise<Blob> => {
  const existing = convertedCache.get(key);
  if (existing) {
    convertedCache.delete(key);
    convertedCache.set(key, existing);
    return existing;
  }
  const work = import('./heicDecode')
    .then(({ decodeHeicBlob }) => decodeHeicBlob(blob, signal))
    .then((converted) => {
      nativeHeicSupported = false;
      return converted;
    });
  convertedCache.set(key, work);
  if (convertedCache.size > MAX_CONVERTED_CACHE) {
    const oldest = convertedCache.keys().next().value;
    if (oldest !== undefined) convertedCache.delete(oldest);
  }
  work.catch(() => convertedCache.get(key) === work && convertedCache.delete(key));
  return work;
};

/**
 * Loads an `m.image` attachment's original picture through the attachment cache, under the
 * event that owns it, and returns a displayable blob URL plus the original bytes when converted.
 */
export const loadImageOriginal = async (
  mx: MatrixClient,
  { url, mimeType, encInfo, owner, signal }: ImageFile
): Promise<LoadedImageOriginal> => {
  // A type the browser would run (SVG) is loaded as plain bytes instead.
  const safeMimeType = getBlobSafeMimeType(mimeType ?? FALLBACK_MIMETYPE);
  const heic = isHeicMimeType(safeMimeType);
  const source = {
    owner,
    mxcUri: url,
    encryptedFile: encInfo ? { ...encInfo, url } : undefined,
    mimeType: safeMimeType,
  };
  const blob = await (heic && nativeHeicSupported !== true
    ? downloadCachedAttachment(mx, source, { signal, maxBytes: MAX_HEIC_BYTES }).catch((error) => {
        if (error instanceof Error && /exceeds the [0-9]+ byte limit/.test(error.message)) {
          throw new HeicDecodeError(error.message, undefined, error);
        }
        throw error;
      })
    : downloadCachedAttachment(mx, source));
  if (!heic && !isHeicMimeType(blob.type)) return { src: URL.createObjectURL(blob) };
  if (nativeHeicSupported !== true && blob.size > MAX_HEIC_BYTES) {
    throw new HeicDecodeError(`HEIC image exceeds ${MAX_HEIC_BYTES} byte decode limit`, blob);
  }
  if (await canDecodeNatively(blob)) return { src: URL.createObjectURL(blob) };
  try {
    const key = `${url}|${encInfo?.hashes?.sha256 ?? ''}`;
    return {
      src: URL.createObjectURL(await convertHeicForDisplay(blob, key, signal)),
      downloadBlob: blob,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new HeicDecodeError(error instanceof Error ? error.message : String(error), blob, error);
  }
};
