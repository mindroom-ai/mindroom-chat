import { isRecord } from '../../lib/isRecord';
import type { IEncryptedFile } from '../types/common';
import { readEncryptedFile } from './encryptedFile';

export { INLINE_MEDIA_CONTENT_KEY } from './metadata';
export const MAX_INLINE_MEDIA_ENTRIES = 64;

export type InlineMediaEntry = { file: IEncryptedFile; mimeType?: string; size?: number };
/** `null` marks a malformed `mxc://` entry so renderers show alt text instead of fetching plaintext. */
export type InlineMediaMap = ReadonlyMap<string, InlineMediaEntry | null>;

export const readInlineMedia = (raw: unknown): InlineMediaMap | undefined => {
  if (!isRecord(raw)) return undefined;
  const map = new Map<string, InlineMediaEntry | null>();
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('mxc://')) continue;
    const file = map.size < MAX_INLINE_MEDIA_ENTRIES ? readEncryptedFile(value) : undefined;
    if (!file || file.url !== key) {
      map.set(key, null);
      continue;
    }
    const { mimetype, size } = value as Record<string, unknown>;
    map.set(key, {
      file,
      mimeType: typeof mimetype === 'string' && mimetype ? mimetype : undefined,
      size: typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : undefined,
    });
  }
  return map.size > 0 ? map : undefined;
};
