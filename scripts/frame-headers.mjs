// @ts-check
// Who may show the app in a frame. Other sites may not (clickjacking): the app keeps its account
// tokens in this origin, and one click in a disguised frame can act for the signed-in user. The app
// frames only its own PDF page (public/pdf-frame.html), so its pages allow their own origin, and
// the pairing page (/connect) allows no frame at all. `frame-ancestors` works only as a header,
// never in index.html's meta policy; `X-Frame-Options` says the same to older browsers.
//
// The values live in frame-headers.json, which serve.py reads too (scripts/frame_headers.py).
// `vite preview` sends them through `frameHeaders()`, the service worker gives the pairing page
// its own when it answers with the cached app shell (src/sw/serviceWorkerFraming.ts), and
// netlify.toml and the nginx start script (docker/entrypoint.d/40-frame-headers.sh) repeat them;
// src/build/frameHeaders.test.ts checks that every copy agrees.
// Vite, Vitest and the service worker build bundle the JSON; plain Node never loads this file.
import policy from './frame-headers.json';

/** Decodes every `%XX` escape on its own, so a malformed one cannot make the check throw. */
const decodeEscapes = (/** @type {string} */ path) =>
  path.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

/**
 * Whether a request path shows the pairing page, in any spelling the router takes for it: the
 * router ignores letter case, decodes escapes and repeated slashes, and the deployment may serve
 * the app under a base path. Any path whose last segment reads `connect` counts, which also
 * covers a room or space of that name; nothing frames those either.
 * @param {string} pathname
 */
export const isPairingPagePath = (pathname) => {
  const segments = decodeEscapes(pathname).toLowerCase().split('/').filter(Boolean);
  return segments.at(-1) === policy.pairingPage;
};

/**
 * The framing headers for a request path (without its query).
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export const framingHeaders = (pathname) => ({
  ...(isPairingPagePath(pathname) ? policy.pairingPageHeaders : policy.otherPageHeaders),
});

/**
 * Vite plugin: `vite preview` answers every request with `framingHeaders`.
 * @returns {import('vite').Plugin}
 */
export const frameHeaders = () => ({
  name: 'mindroom-frame-headers',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const [pathname = '/'] = (req.url ?? '/').split('?');
      Object.entries(framingHeaders(pathname)).forEach(([name, value]) => {
        res.setHeader(name, value);
      });
      next();
    });
  },
});
