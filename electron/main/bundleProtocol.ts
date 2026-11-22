import fs from 'node:fs';
import path from 'node:path';
import { protocol } from 'electron';
import { contentType } from 'mime-types';
import { framingHeaders } from '../../scripts/frame-headers.mjs';

const APP_SCHEME = 'capacitor';
export const APP_ORIGIN = `${APP_SCHEME}://localhost`;
export const FRAME_PAGE_FILES: readonly string[] = ['pdf-frame.html'];

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

const readBundleFile = async (
  realRoot: string,
  relative: string,
  headOnly: boolean
): Promise<{ file: string; fullPath: string; body: Buffer | null } | undefined> => {
  const lexical = path.resolve(realRoot, relative);
  if (!lexical.startsWith(`${realRoot}${path.sep}`)) return undefined;
  try {
    if ((await fs.promises.realpath(lexical)) !== lexical) return undefined;
    if (!(await fs.promises.stat(lexical)).isFile()) return undefined;
    return {
      file: relative,
      fullPath: lexical,
      body: headOnly ? null : await fs.promises.readFile(lexical),
    };
  } catch {
    return undefined;
  }
};

// Packaged, `dist` lives inside the signed, read-only `app.asar`; from a checkout, anyone who can
// write `dist` can already run code as the user, so mid-request parent swaps are out of scope.
// Serves only a regular file whose real path equals the requested path inside root. No open handle:
// inside asar, `fs.open` copies the file out to a temporary file first.
export const serveBundle = (distDir: string): void => {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(path.resolve(distDir));
  } catch {
    throw new Error(`No web bundle at ${distDir}: run \`npm run build:desktop\` first`);
  }
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const url = parseAppUrl(request.url);
    if (!url) return new Response('Not Found', { status: 404 });
    const headOnly = request.method === 'HEAD';
    const candidate = resolveBundlePath(url.pathname, () => true);
    if ('status' in candidate) return new Response('Not Found', { status: candidate.status });
    let served = await readBundleFile(realRoot, candidate.file, headOnly);
    if (!served) {
      const fallback = resolveBundlePath(url.pathname, (rel) => rel === 'index.html');
      if ('status' in fallback) return new Response('Not Found', { status: fallback.status });
      served = await readBundleFile(realRoot, fallback.file, headOnly);
    }
    if (!served) return new Response('Not Found', { status: 404 });
    const headers: Record<string, string> = {
      'Content-Type': contentType(path.basename(served.fullPath)) || 'application/octet-stream',
      ...(served.file.endsWith('.html') ? framingHeaders(url.pathname) : {}),
    };
    return new Response(served.body, { status: 200, headers });
  });
};
