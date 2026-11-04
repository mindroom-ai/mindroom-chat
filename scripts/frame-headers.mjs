// @ts-check
// Who may show the app in a frame. Other sites may not (clickjacking): the app keeps its account
// tokens in this origin, and one click in a disguised frame can act for the signed-in user. The app
// frames only its own PDF page (public/pdf-frame.html), so its pages allow their own origin, and
// the pairing page (/connect) allows no frame at all. `frame-ancestors` works only as a header,
// never in index.html's meta policy; `X-Frame-Options` says the same to older browsers.
// `vite preview` sends these headers through `frameHeaders()`; netlify.toml repeats them for
// Netlify, and a deployment behind its own web server should send the same.

/** The pairing page: a pairing code in a frame could be approved by a click the user never meant. */
const UNFRAMEABLE_PAGE = /(?:^|\/)connect\/?$/;

/**
 * The framing headers for a request path.
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export const framingHeaders = (pathname) =>
  UNFRAMEABLE_PAGE.test(pathname)
    ? { 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' }
    : { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' };

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
