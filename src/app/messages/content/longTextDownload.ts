import { MatrixClient } from 'matrix-js-sdk';
import { ESSENTIAL_BODY_MAX_BYTES } from '../../matrix/protocol/eventAttachments';
import { LongTextSource } from '../../matrix/protocol/longText';
import { downloadSidecarBlob } from '../../event-store/cache/sidecarDownload';

const FILENAME_INVALID_CHARS = /[<>:"/\\|?*]/g;
const FILENAME_EXT_REG = /\.[A-Za-z0-9]{1,8}$/;
const MXC_URI_MEDIA_ID_REG = /^mxc:\/\/[^/]+\/(.+)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const sanitizeFilename = (value: string): string =>
  value.replace(FILENAME_INVALID_CHARS, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

const getMxcMediaId = (mxcUri: string): string | undefined => {
  const mediaId = mxcUri.match(MXC_URI_MEDIA_ID_REG)?.[1];
  if (!mediaId) return undefined;
  return sanitizeFilename(mediaId);
};

export const getLongTextDownloadName = (source: LongTextSource): string => {
  const info = isRecord(source.previewContent.info) ? source.previewContent.info : undefined;
  const infoName = typeof info?.name === 'string' ? sanitizeFilename(info.name) : undefined;
  const fallbackId = getMxcMediaId(source.mxcUri);
  const baseName =
    infoName || (fallbackId ? `mindroom-long-text-${fallbackId}` : 'mindroom-long-text');
  const ext = source.isV2ContentJson ? '.json' : '.txt';
  if (FILENAME_EXT_REG.test(baseName)) return baseName;
  return `${baseName}${ext}`;
};

const getLongTextMimeType = (content: Record<string, unknown>): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  return typeof info?.mimetype === 'string' ? info.mimetype : 'application/json';
};

export const downloadLongTextSidecarBlob = async (
  mx: MatrixClient,
  source: LongTextSource,
  originalFile = false
): Promise<Blob> => {
  return downloadSidecarBlob(
    mx,
    source,
    getLongTextMimeType(source.previewContent),
    originalFile ? {} : { essential: true, maxBytes: ESSENTIAL_BODY_MAX_BYTES }
  );
};
