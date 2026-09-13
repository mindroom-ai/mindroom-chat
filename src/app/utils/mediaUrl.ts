import { MatrixClient } from 'matrix-js-sdk';
import { getActiveSession } from '../state/sessions';
import { trimTrailingSlash } from './common';

const rebaseMediaUrlToHomeserverPath = (mx: MatrixClient, mediaUrl: string): string => {
  try {
    const homeserverUrl = new URL(mx.getHomeserverUrl());
    const parsedMediaUrl = new URL(mediaUrl);

    if (parsedMediaUrl.origin !== homeserverUrl.origin) return mediaUrl;
    if (!parsedMediaUrl.pathname.startsWith('/_matrix/')) return mediaUrl;

    const homeserverPath = trimTrailingSlash(homeserverUrl.pathname);
    if (!homeserverPath) return mediaUrl;
    if (parsedMediaUrl.pathname.startsWith(`${homeserverPath}/_matrix/`)) return mediaUrl;

    parsedMediaUrl.pathname = `${homeserverPath}${parsedMediaUrl.pathname}`;
    return parsedMediaUrl.toString();
  } catch {
    return mediaUrl;
  }
};

export const mxcUrlToHttp = (
  mx: MatrixClient,
  mxcUrl: string,
  useAuthentication?: boolean,
  width?: number,
  height?: number,
  resizeMethod?: string,
  allowDirectLinks?: boolean,
  allowRedirects?: boolean
): string | null => {
  const rawMediaUrl = mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    allowRedirects,
    useAuthentication
  );
  const mediaUrl = rawMediaUrl ? rebaseMediaUrlToHomeserverPath(mx, rawMediaUrl) : rawMediaUrl;

  if (!mediaUrl || !useAuthentication) return mediaUrl;
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return mediaUrl;
  if (window.location?.protocol !== 'capacitor:') return mediaUrl;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) return mediaUrl;

  const accessToken = getActiveSession()?.accessToken;
  if (!accessToken) return mediaUrl;

  try {
    const urlObj = new URL(mediaUrl);
    if (!urlObj.pathname.includes('/_matrix/client/v1/media/')) return mediaUrl;
    // Capacitor iOS lacks service workers, so native media elements cannot receive
    // Authorization headers. Use a query token fallback for authenticated media.
    urlObj.searchParams.set('access_token', accessToken);
    return urlObj.toString();
  } catch {
    return mediaUrl;
  }
};
