import type { MatrixClient } from 'matrix-js-sdk';
import {
  getCachedAttachmentCacheMetadata,
  loadCachedScaledPictureBlob,
  saveCachedScaledPicture,
} from '../../event-store/cache/attachmentRepository';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
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
 * A blob URL of the picture for the timeline: the original when this device saved it, else the
 * homeserver's scaled copy, from this device's cache or else from the homeserver (then saved for
 * `owner`, the event revision that shows it, so it shows offline too), else the original after all.
 */
export const loadServerScaledPicture = async (
  mx: MatrixClient,
  mxcUri: string,
  loadOriginal: () => Promise<string>,
  owner?: EventAttachmentOwner
): Promise<string> => {
  const saved = await getCachedAttachmentCacheMetadata(mx, mxcUri).catch(() => undefined);
  if (saved) return loadOriginal();
  const savedScaled = await loadCachedScaledPictureBlob(mx, mxcUri).catch(() => undefined);
  const scaled = savedScaled ?? (await downloadServerThumbnail(mx, mxcUri).catch(() => undefined));
  if (!scaled) return loadOriginal();
  const type = getBlobSafeMimeType(scaled.type || FALLBACK_MIMETYPE);
  const picture = new Blob([scaled], { type });
  if (!savedScaled) void saveCachedScaledPicture(mx, mxcUri, picture, owner).catch(() => undefined);
  return URL.createObjectURL(picture);
};
