import type { MatrixClient } from 'matrix-js-sdk';
import { mxcUrlToHttp } from '../utils/mediaUrl';
import type { PowerLevelTagIcon } from './usePowerLevelTags';

/**
 * The image source of a tag icon: the emoji itself, or the HTTP URL of an `mxc://` image. Other
 * URLs are dropped, since tags come from room state anyone with permission can write.
 */
export const getPowerTagIconSrc = (
  client: MatrixClient,
  authenticatedMedia: boolean,
  icon: PowerLevelTagIcon
): string | undefined => {
  const { key } = icon;
  if (key.startsWith('mxc://')) return mxcUrlToHttp(client, key, authenticatedMedia) ?? undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(key)) return undefined;
  return key;
};
