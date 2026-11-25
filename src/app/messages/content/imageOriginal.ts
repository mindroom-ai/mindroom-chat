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

/** Max HEIC byte size rendered inline; larger files render as a file row to download. */
export const MAX_HEIC_BYTES = 30 * 1024 * 1024;

/** A HEIC/HEIF picture could not be decoded or exceeded the decode size budget. */
export class HeicDecodeError extends Error {
  constructor(
    message: string,
    readonly originalBlob?: Blob,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'HeicDecodeError';
  }
}

// Bounded LRU of completed converted HEIC blobs.
const MAX_CONVERTED_CACHE = 16;
const convertedCache = new Map<string, Blob>();
let nativeHeicSupported: boolean | undefined;

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

export const resetHeicDecodeStateForTests = (): void => {
  nativeHeicSupported = undefined;
  convertedCache.clear();
};

const isHeifContainer = async (blob: Blob): Promise<boolean> => {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  if (head.length < 12) return false;
  const ascii = String.fromCharCode(...head);
  if (ascii.slice(4, 8) !== 'ftyp') return false;
  const boxSize = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0);
  const end = boxSize === 0 ? head.length : Math.min(boxSize, head.length);
  if (end < 12) return false;
  const brands = [ascii.slice(8, 12)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii.slice(i, i + 4));
  return (
    !brands.includes('avif') &&
    !brands.includes('avis') &&
    brands.some((brand) => HEIF_BRANDS.has(brand))
  );
};

const canDecodeNatively = async (blob: Blob): Promise<boolean> => {
  if (nativeHeicSupported !== undefined) return nativeHeicSupported;
  if (typeof createImageBitmap !== 'function') return false;
  try {
    (await createImageBitmap(blob)).close();
    if (await isHeifContainer(blob)) nativeHeicSupported = true;
    return true;
  } catch {
    return false;
  }
};

const convertHeicForDisplay = async (
  blob: Blob,
  key: string,
  signal?: AbortSignal
): Promise<Blob> => {
  const existing = convertedCache.get(key);
  if (existing) {
    convertedCache.delete(key);
    convertedCache.set(key, existing);
    return existing;
  }
  const { decodeHeicBlob } = await import('./heicDecode');
  const converted = await decodeHeicBlob(blob, signal);
  if (nativeHeicSupported === undefined && (await isHeifContainer(blob))) {
    nativeHeicSupported = false;
  }
  convertedCache.delete(key);
  convertedCache.set(key, converted);
  if (convertedCache.size > MAX_CONVERTED_CACHE) {
    const oldest = convertedCache.keys().next().value;
    if (oldest !== undefined) convertedCache.delete(oldest);
  }
  return converted;
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
  const blob = await (heic
    ? downloadCachedAttachment(mx, source, { signal, maxBytes: MAX_HEIC_BYTES }).catch((error) => {
        if (error instanceof Error && /exceeds the [0-9]+ byte limit/.test(error.message)) {
          throw new HeicDecodeError(error.message, undefined, error);
        }
        throw error;
      })
    : downloadCachedAttachment(mx, source, signal ? { signal } : undefined));
  if (!heic && !isHeicMimeType(blob.type)) return { src: URL.createObjectURL(blob) };
  if (blob.size > MAX_HEIC_BYTES) {
    throw new HeicDecodeError(`HEIC image exceeds ${MAX_HEIC_BYTES} byte decode limit`, blob);
  }
  if (await canDecodeNatively(blob)) return { src: URL.createObjectURL(blob) };
  try {
    // An encrypted file's key and IV are part of the cache key, so a wrong key never reuses another event's pixels.
    const key = `${url}|${encInfo?.hashes?.sha256 ?? ''}|${encInfo?.key?.k ?? ''}|${encInfo?.iv ?? ''}`;
    return {
      src: URL.createObjectURL(await convertHeicForDisplay(blob, key, signal)),
      downloadBlob: blob,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new HeicDecodeError(error instanceof Error ? error.message : String(error), blob, error);
  }
};
