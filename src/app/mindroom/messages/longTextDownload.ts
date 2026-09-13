import { MatrixClient } from 'matrix-js-sdk';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../utils/matrix';
import { validMediaRequest } from '../../../swMediaAuth';
import { MindroomLongTextSource } from './longText';

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

export const getMindroomLongTextDownloadName = (source: MindroomLongTextSource): string => {
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

const downloadSidecarBlob = async (
  source: MindroomLongTextSource,
  textUrl: string,
  requestInit?: RequestInit
): Promise<Blob> => {
  const encryptedFile = source.encryptedFile;
  if (!encryptedFile) {
    return requestInit ? downloadMedia(textUrl, requestInit) : downloadMedia(textUrl);
  }

  const mimeType = getLongTextMimeType(source.previewContent);
  const decryptContent = (encBuf: ArrayBuffer) => decryptFile(encBuf, mimeType, encryptedFile);
  return requestInit
    ? downloadEncryptedMedia(textUrl, decryptContent, requestInit)
    : downloadEncryptedMedia(textUrl, decryptContent);
};

const getAuthenticatedRequestInit = (
  mx: MatrixClient,
  textUrl: string,
  useAuthentication: boolean
): RequestInit | undefined => {
  if (!useAuthentication) return undefined;

  const accessToken = mx.getAccessToken();
  if (!accessToken || !validMediaRequest(textUrl, mx.getHomeserverUrl())) return undefined;

  return {
    headers: { Authorization: `Bearer ${accessToken}` },
  };
};

export const downloadMindroomLongTextSidecarBlob = async (
  mx: MatrixClient,
  source: MindroomLongTextSource,
  useAuthentication: boolean
): Promise<Blob> => {
  const textUrl = mxcUrlToHttp(mx, source.mxcUri, useAuthentication);
  if (!textUrl) {
    throw new Error('Unable to resolve sidecar URL');
  }

  return downloadSidecarBlob(
    source,
    textUrl,
    getAuthenticatedRequestInit(mx, textUrl, useAuthentication)
  );
};

export const downloadMindroomLongTextSidecarText = async (
  mx: MatrixClient,
  source: MindroomLongTextSource,
  useAuthentication: boolean
): Promise<string> => {
  const blob = await downloadMindroomLongTextSidecarBlob(mx, source, useAuthentication);
  return blob.text();
};
