import type { MatrixClient } from 'matrix-js-sdk';
import { getCachedAttachmentCacheMetadata } from '../../event-store/cache/attachmentRepository';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType } from '../../lib/mimeTypes';
import { readClientCachedSpecVersions } from '../../matrix/cachedSpecVersions';
import {
  authenticatedMediaRequestInit,
  mxcUrlToHttp,
  supportsAuthenticatedMedia,
} from '../../matrix/mediaUrl';

/** The box the homeserver scales a picture into for the timeline (a size servers keep ready). */
const SERVER_THUMBNAIL_SIZE = { width: 800, height: 600 } as const;

// Pictures a homeserver scales without losing anything: no animation, no script.
const SCALABLE_TYPES = new Set(['image/png', 'image/jpeg']);

/** Whether the timeline asks the homeserver for a scaled copy instead of the original. */
export const canUseServerThumbnail = (mimeType: string | undefined, encrypted: boolean): boolean =>
  !encrypted && SCALABLE_TYPES.has(mimeType ?? '');

/**
 * An unencrypted picture scaled down by the homeserver (`/thumbnail`, method `scale`). The request
 * carries the access token itself, as attachment downloads do; the versions the client last cached
 * decide the endpoint when the server's answer is not there.
 */
const downloadServerThumbnail = async (mx: MatrixClient, mxcUri: string): Promise<Blob> => {
  const authenticated = await mx
    .getVersions()
    .then(supportsAuthenticatedMedia)
    .catch(() => {
      const cached = readClientCachedSpecVersions(mx);
      return cached ? supportsAuthenticatedMedia(cached) : false;
    });
  const { width, height } = SERVER_THUMBNAIL_SIZE;
  const url = mxcUrlToHttp(mx, mxcUri, authenticated, width, height, 'scale');
  if (!url) throw new Error('Unable to resolve thumbnail URL');
  const requestInit = authenticated ? authenticatedMediaRequestInit(mx, url) : undefined;
  const response = await fetch(url, { ...requestInit, method: 'GET' });
  if (!response.ok) throw new Error(`Unable to load thumbnail (${response.status})`);
  return response.blob();
};

/**
 * A blob URL of the picture for the timeline: the original when this device saved it (so it shows
 * offline too), else the homeserver's scaled copy, else the original after all.
 */
export const loadServerScaledPicture = async (
  mx: MatrixClient,
  mxcUri: string,
  loadOriginal: () => Promise<string>
): Promise<string> => {
  const saved = await getCachedAttachmentCacheMetadata(mx, mxcUri).catch(() => undefined);
  if (saved) return loadOriginal();
  const scaled = await downloadServerThumbnail(mx, mxcUri).catch(() => undefined);
  if (!scaled) return loadOriginal();
  const type = getBlobSafeMimeType(scaled.type || FALLBACK_MIMETYPE);
  return URL.createObjectURL(new Blob([scaled], { type }));
};
