import { MatrixClient } from 'matrix-js-sdk';
import { getActiveSession } from '../state/sessions';

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
  const mediaUrl = mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    allowRedirects,
    useAuthentication
  );

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
