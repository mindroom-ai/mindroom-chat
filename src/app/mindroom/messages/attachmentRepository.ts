import type { MatrixClient } from 'matrix-js-sdk';
import type { IEncryptedFile } from '../../../types/matrix/common';
import { createSessionId } from '../../state/sessions';
import { validMediaRequest } from '../../../swMediaAuth';
import { decryptFile, downloadMedia, mxcUrlToHttp } from '../../utils/matrix';
import {
  captureCacheStoreWriteLease,
  getCachedAttachmentMetadata,
  loadCachedAttachment,
  putCachedAttachment,
  type CachedAttachmentMetadata,
} from '../threads/cacheStore';

export type CachedAttachmentSource = {
  mxcUri: string;
  encryptedFile?: IEncryptedFile;
  mimeType?: string;
};

export type CachedAttachmentDownloadOptions = {
  roomId?: string;
  essential?: boolean;
  signal?: AbortSignal;
  maxBytes?: number;
};

type RawAttachment = {
  bytes: ArrayBuffer;
  mimeType: string;
};

const inflightDownloads = new Map<string, Promise<RawAttachment>>();

const getSessionId = (mx: MatrixClient): string =>
  createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());

const getInflightKey = (sessionId: string, mxcUri: string): string =>
  JSON.stringify([sessionId, mxcUri]);

const abortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const awaitWithSignal = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

const enforceMaxBytes = (byteLength: number, maxBytes?: number): void => {
  if (maxBytes !== undefined && byteLength > maxBytes) {
    throw new Error(`Attachment exceeds the ${maxBytes} byte limit`);
  }
};

const fetchRawAttachment = async (
  mx: MatrixClient,
  source: CachedAttachmentSource,
  useAuthentication: boolean
): Promise<RawAttachment> => {
  const url = mxcUrlToHttp(mx, source.mxcUri, useAuthentication);
  if (!url) throw new Error('Unable to resolve sidecar URL');
  const token = useAuthentication ? mx.getAccessToken() : undefined;
  const requestInit =
    token && validMediaRequest(url, mx.getHomeserverUrl())
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined;
  const blob = requestInit ? await downloadMedia(url, requestInit) : await downloadMedia(url);
  return {
    bytes: await blob.arrayBuffer(),
    mimeType: source.mimeType || blob.type || 'application/octet-stream',
  };
};

const getOrCreateTransport = (
  mx: MatrixClient,
  sessionId: string,
  source: CachedAttachmentSource,
  useAuthentication: boolean
): Promise<RawAttachment> => {
  const key = getInflightKey(sessionId, source.mxcUri);
  const current = inflightDownloads.get(key);
  if (current) return current;
  const pending = fetchRawAttachment(mx, source, useAuthentication).finally(() => {
    if (inflightDownloads.get(key) === pending) inflightDownloads.delete(key);
  });
  inflightDownloads.set(key, pending);
  return pending;
};

const toConsumerBlob = async (
  raw: RawAttachment,
  source: CachedAttachmentSource
): Promise<Blob> => {
  const mimeType = source.mimeType || raw.mimeType;
  if (!source.encryptedFile) return new Blob([raw.bytes], { type: mimeType });
  return decryptFile(raw.bytes.slice(0), mimeType, source.encryptedFile);
};

export const downloadCachedAttachment = async (
  mx: MatrixClient,
  source: CachedAttachmentSource,
  useAuthentication: boolean,
  options: CachedAttachmentDownloadOptions = {}
): Promise<Blob> => {
  const sessionId = getSessionId(mx);
  const writeLease = captureCacheStoreWriteLease(sessionId);
  const cached = await awaitWithSignal(
    loadCachedAttachment(sessionId, source.mxcUri),
    options.signal
  );
  if (cached) {
    enforceMaxBytes(cached.byteLength, options.maxBytes);
    await putCachedAttachment(
      sessionId,
      { bytes: cached.bytes, mimeType: cached.mimeType, mxcUri: source.mxcUri },
      { ...options, writeLease }
    );
    return toConsumerBlob({ bytes: cached.bytes, mimeType: cached.mimeType }, source);
  }

  const raw = await awaitWithSignal(
    getOrCreateTransport(mx, sessionId, source, useAuthentication),
    options.signal
  );
  enforceMaxBytes(raw.bytes.byteLength, options.maxBytes);
  await putCachedAttachment(
    sessionId,
    { bytes: raw.bytes, mimeType: raw.mimeType, mxcUri: source.mxcUri },
    { ...options, writeLease }
  );
  return toConsumerBlob(raw, source);
};

export const getCachedAttachmentCacheMetadata = (
  mx: MatrixClient,
  mxcUri: string
): Promise<CachedAttachmentMetadata | undefined> =>
  getCachedAttachmentMetadata(getSessionId(mx), mxcUri);

export const clearAttachmentRepositoryMemory = (): void => {
  inflightDownloads.clear();
};
