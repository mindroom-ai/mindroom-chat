import type { IEncryptedFile } from '../types/common';
import { readEncryptedFile } from './chatUiProtocol';

export const INLINE_MEDIA_CONTENT_KEY = 'io.mindroom.inline_media';

/** Bounds hostile payloads; each v2 descriptor is ~450 B against Matrix's 64 KiB event cap. */
export const MAX_INLINE_MEDIA_ENTRIES = 64;

export type InlineMediaEntry = {
  file: IEncryptedFile;
  mimeType?: string;
  size?: number;
};

/**
 * Validated encrypted inline media entries keyed by `mxc://` URI.
 * A `null` value marks an `mxc://` key present in `io.mindroom.inline_media` whose descriptor
 * failed validation so renderers show alt text instead of falling back to a plaintext fetch.
 */
export type InlineMediaMap = ReadonlyMap<string, InlineMediaEntry | null>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Reads `io.mindroom.inline_media` from a message revision's content, validating each v2
 * `EncryptedFile` entry and requiring `entry.url === key` up to `MAX_INLINE_MEDIA_ENTRIES`.
 */
export const readInlineMedia = (content: unknown): InlineMediaMap | undefined => {
  if (!isRecord(content)) return undefined;
  const raw = content[INLINE_MEDIA_CONTENT_KEY];
  if (!isRecord(raw)) return undefined;

  const map = new Map<string, InlineMediaEntry | null>();
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('mxc://')) continue;
    if (map.size >= MAX_INLINE_MEDIA_ENTRIES) break;
    const file = readEncryptedFile(value);
    if (!file || file.url !== key) {
      map.set(key, null);
      continue;
    }
    const rawEntry = value as Record<string, unknown>;
    const mimeType =
      typeof rawEntry.mimetype === 'string' && rawEntry.mimetype.length > 0
        ? rawEntry.mimetype
        : undefined;
    const size =
      typeof rawEntry.size === 'number' && Number.isSafeInteger(rawEntry.size) && rawEntry.size >= 0
        ? rawEntry.size
        : undefined;
    map.set(key, {
      file: mimeType ? { ...file, mimetype: mimeType } : file,
      mimeType,
      size,
    });
  }
  return map.size > 0 ? map : undefined;
};
