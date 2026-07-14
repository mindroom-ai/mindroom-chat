import { MatrixClient } from 'matrix-js-sdk';
import { validMediaRequest } from '../../swMediaAuth';
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
  const isCapacitor = typeof window !== 'undefined' && window.location?.protocol === 'capacitor:';
  const effectiveAllowRedirects = isCapacitor && useAuthentication ? false : allowRedirects;
  const rawMediaUrl = mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    effectiveAllowRedirects,
    useAuthentication
  );
  const mediaUrl = rawMediaUrl ? rebaseMediaUrlToHomeserverPath(mx, rawMediaUrl) : rawMediaUrl;

  if (!mediaUrl || !useAuthentication) return mediaUrl;
  if (typeof window === 'undefined') return mediaUrl;

  // Browser URLs stay token-free even before service-worker takeover. Startup
  // waits briefly for control, and a failed media request is preferable to
  // exposing a bearer token in DOM attributes, history, or logs.
  if (!isCapacitor) return mediaUrl;

  const accessToken = mx.getAccessToken();
  if (!accessToken) return mediaUrl;
  if (!validMediaRequest(mediaUrl, mx.getHomeserverUrl())) return mediaUrl;

  // Capacitor iOS lacks service workers, so native media elements cannot receive
  // Authorization headers. Use a query token fallback for authenticated media.
  // The Matrix SDK currently forces allow_redirect=true whenever authenticated
  // media is requested, so override the resulting query as well as its input.
  // validMediaRequest already ruled out unparseable URLs.
  const urlObj = new URL(mediaUrl);
  urlObj.searchParams.set('allow_redirect', 'false');
  urlObj.searchParams.set('access_token', accessToken);
  return urlObj.toString();
};
