import { createContext } from 'react';
import type { IEncryptedFile } from '../types/common';
import { readEncryptedFile } from './chatUiProtocol';
import type { EventAttachmentOwner } from './eventAttachments';

export const INLINE_MEDIA_CONTENT_KEY = 'io.mindroom.inline_media';
export const MAX_INLINE_MEDIA_ENTRIES = 64;

export type InlineMediaEntry = { file: IEncryptedFile; mimeType?: string; size?: number };
/** `null` marks a malformed `mxc://` entry so renderers show alt text instead of fetching plaintext. */
export type InlineMediaMap = ReadonlyMap<string, InlineMediaEntry | null>;
export type InlineMediaContextValue = { entries: InlineMediaMap; owner?: EventAttachmentOwner };

export const InlineMediaContext = createContext<InlineMediaContextValue | undefined>(undefined);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

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
    const { mimetype, size } = value as Record<string, unknown>;
    map.set(key, {
      file,
      mimeType: typeof mimetype === 'string' && mimetype ? mimetype : undefined,
      size: typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : undefined,
    });
  }
  return map.size > 0 ? map : undefined;
};
