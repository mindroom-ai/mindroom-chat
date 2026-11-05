import { framingHeaders, isPairingPagePath } from '../../scripts/frame-headers.mjs';

/**
 * The service worker answers every app route with the cached app shell, which carries the headers
 * the server sent for index.html. The pairing page allows no frame at all, so its answer gets the
 * pairing page's own framing headers (scripts/frame-headers.mjs) whatever the shell carried.
 * Other answers, and those whose headers a worker cannot read (opaque redirects), pass unchanged.
 */
export const withPageFraming = (requestUrl: string, response: Response): Response => {
  if (response.type !== 'basic' && response.type !== 'default') return response;
  const { pathname } = new URL(requestUrl);
  if (!isPairingPagePath(pathname)) return response;
  const headers = new Headers(response.headers);
  Object.entries(framingHeaders(pathname)).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
