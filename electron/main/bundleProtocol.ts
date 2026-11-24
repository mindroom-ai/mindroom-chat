import fs from 'node:fs';
import path from 'node:path';
import { protocol } from 'electron';
import { contentType } from 'mime-types';
import { framingHeaders } from '../../scripts/frame-headers.mjs';

declare const __MINDROOM_CANVAS_LIBRARIES__: string | undefined;

const APP_SCHEME = 'capacitor';
export const APP_ORIGIN = `${APP_SCHEME}://localhost`;
const CANVAS_FRAME_FILE = 'canvas-frame.html';
export const FRAME_PAGE_FILES: readonly string[] = ['pdf-frame.html', CANVAS_FRAME_FILE];
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);

const CANVAS_LIB_SOURCE = `${APP_ORIGIN}/${
  typeof __MINDROOM_CANVAS_LIBRARIES__ === 'string'
    ? __MINDROOM_CANVAS_LIBRARIES__
    : 'assets/canvas-libs'
}/`;

export const CANVAS_FRAME_POLICY = [
  "sandbox allow-scripts allow-forms; default-src 'none'",
  `script-src 'unsafe-inline' ${CANVAS_LIB_SOURCE} https:; style-src 'unsafe-inline' ${CANVAS_LIB_SOURCE} https:`,
  'img-src data: blob: https:; font-src data: https:; media-src data: blob: https:',
  "connect-src 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'",
].join('; ');

const withCsp = (pathname: string, policy: string): Record<string, string> => {
  const framing = framingHeaders(pathname);
  const csp = [framing['Content-Security-Policy'], policy].filter(Boolean).join('; ');
  return { ...framing, 'Content-Security-Policy': csp };
};

export const scriptPolicy = "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:";

export const pageHeaders = (pathname: string): Record<string, string> =>
  withCsp(pathname, scriptPolicy);

const NON_HTML_CSP = `${scriptPolicy}; object-src 'none'`;
const textResponse = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'Content-Security-Policy': NON_HTML_CSP } });

export const parseAppUrl = (raw: string): URL | undefined => {
  try {
    const u = new URL(raw);
    return u.protocol === `${APP_SCHEME}:` && u.host === 'localhost' && !u.username && !u.password
      ? u
      : undefined;
  } catch {
    return undefined;
  }
};

export const resolveBundlePath = (
  pathname: string,
  isFile: (relative: string) => boolean
): { file: string } | { status: 404 } => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.split(/[?#]/, 1)[0] ?? '');
  } catch {
    return { status: 404 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 404 };
  const parts = decoded.split('/');
  if (parts.some((p) => p === '.' || p === '..')) return { status: 404 };
  const segments = parts.filter(Boolean);
  const relative = segments.join('/');
  if (segments.length > 0 && !decoded.endsWith('/') && isFile(relative)) return { file: relative };
  const first = segments[0] ?? '';
  if (first === 'assets' || first.startsWith('_capacitor_')) return { status: 404 };
  return isFile('index.html') ? { file: 'index.html' } : { status: 404 };
};

export const isFramePage = (pathname: string): boolean => {
  const res = resolveBundlePath(pathname, (rel) => FRAME_PAGE_FILES.includes(rel));
  return 'file' in res && FRAME_PAGE_FILES.includes(res.file);
};

export const isAllowedAppPage = (rawUrl: string): boolean => {
  const parsed = parseAppUrl(rawUrl);
  return parsed !== undefined && !isFramePage(parsed.pathname);
};

export const registerBundleScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
        stream: true,
        supportFetchAPI: true,
        allowServiceWorkers: false,
      },
    },
  ]);
};

const toBodyBytes = (buffer: Buffer): Uint8Array<ArrayBuffer> =>
  buffer.buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);

const readBundleFile = async (
  realRoot: string,
  relative: string,
  headOnly: boolean
): Promise<
  { file: string; fullPath: string; body: Uint8Array<ArrayBuffer> | null } | undefined
> => {
  const lexical = path.resolve(realRoot, relative);
  if (!lexical.startsWith(`${realRoot}${path.sep}`)) return undefined;
  let handle: fs.promises.FileHandle | undefined;
  try {
    if ((await fs.promises.realpath(lexical)) !== lexical) return undefined;
    handle = await fs.promises.open(lexical, OPEN_FLAGS);
    if (!(await handle.stat()).isFile()) return undefined;
    return {
      file: relative,
      fullPath: lexical,
      body: headOnly ? null : toBodyBytes(await handle.readFile()),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
};

// Packaged, `dist` lives inside the signed, read-only `app.asar`; from a checkout, anyone who can
// write `dist` can already run code as the user, so mid-request parent swaps are out of scope.
// Serves only a regular file whose real path equals the requested path inside root, from one handle
// (inside asar, Electron reads packed entries through the archive descriptor, no temp copy).
export const serveBundle = (distDir: string): void => {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(path.resolve(distDir));
  } catch {
    throw new Error(`No web bundle at ${distDir}: run \`npm run build:desktop\` first`);
  }
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method Not Allowed', 405);
    }
    const url = parseAppUrl(request.url);
    if (!url) return textResponse('Not Found', 404);
    const headOnly = request.method === 'HEAD';
    const candidate = resolveBundlePath(url.pathname, () => true);
    if ('status' in candidate) return textResponse('Not Found', candidate.status);
    let served = await readBundleFile(realRoot, candidate.file, headOnly);
    if (!served) {
      const fallback = resolveBundlePath(url.pathname, (rel) => rel === 'index.html');
      if ('status' in fallback) return textResponse('Not Found', fallback.status);
      served = await readBundleFile(realRoot, fallback.file, headOnly);
    }
    if (!served) return textResponse('Not Found', 404);
    const headers: Record<string, string> = {
      'Content-Type': contentType(path.basename(served.fullPath)) || 'application/octet-stream',
      ...(served.file === CANVAS_FRAME_FILE
        ? withCsp(url.pathname, CANVAS_FRAME_POLICY)
        : served.file.endsWith('.html')
        ? pageHeaders(url.pathname)
        : { 'Content-Security-Policy': NON_HTML_CSP }),
    };
    return new Response(served.body, { status: 200, headers });
  });
};
