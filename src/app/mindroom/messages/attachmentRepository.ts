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

type SharedAttachmentOperation = {
  promise: Promise<RawAttachment>;
  consumers: number;
  settled: boolean;
};

const inflightDownloads = new Map<string, SharedAttachmentOperation>();

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

const acquireAttachment = (
  mx: MatrixClient,
  sessionId: string,
  source: CachedAttachmentSource,
  useAuthentication: boolean
): { promise: Promise<RawAttachment>; release: () => void } => {
  const key = getInflightKey(sessionId, source.mxcUri);
  let operation = inflightDownloads.get(key);
  if (!operation) {
    let created: SharedAttachmentOperation | undefined;
    const promise = loadCachedAttachment(sessionId, source.mxcUri).then((cached) => {
      if (cached) return { bytes: cached.bytes, mimeType: cached.mimeType };
      if (!created || created.consumers === 0) throw abortError();
      return fetchRawAttachment(mx, source, useAuthentication);
    });
    created = { promise, consumers: 0, settled: false };
    operation = created;
    inflightDownloads.set(key, created);
    const markSettled = () => {
      created.settled = true;
      if (created.consumers === 0 && inflightDownloads.get(key) === created) {
        inflightDownloads.delete(key);
      }
    };
    promise.then(markSettled, markSettled);
  }

  const acquired = operation;
  acquired.consumers += 1;
  let released = false;
  return {
    promise: acquired.promise,
    release: () => {
      if (released) return;
      released = true;
      acquired.consumers -= 1;
      if (acquired.settled && acquired.consumers === 0 && inflightDownloads.get(key) === acquired) {
        inflightDownloads.delete(key);
      }
    },
  };
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
  if (options.signal?.aborted) throw abortError();
  const sessionId = getSessionId(mx);
  const writeLease = captureCacheStoreWriteLease(sessionId);
  const attachment = acquireAttachment(mx, sessionId, source, useAuthentication);
  try {
    const raw = await awaitWithSignal(attachment.promise, options.signal);
    enforceMaxBytes(raw.bytes.byteLength, options.maxBytes);
    const consumerBlob = await awaitWithSignal(toConsumerBlob(raw, source), options.signal);
    await awaitWithSignal(
      putCachedAttachment(
        sessionId,
        { bytes: raw.bytes, mimeType: raw.mimeType, mxcUri: source.mxcUri },
        { ...options, writeLease }
      ),
      options.signal
    );
    if (options.signal?.aborted) throw abortError();
    return consumerBlob;
  } finally {
    attachment.release();
  }
};

export const getCachedAttachmentCacheMetadata = (
  mx: MatrixClient,
  mxcUri: string
): Promise<CachedAttachmentMetadata | undefined> =>
  getCachedAttachmentMetadata(getSessionId(mx), mxcUri);

export const clearAttachmentRepositoryMemory = (): void => {
  inflightDownloads.clear();
};
