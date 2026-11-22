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

const indexFiles = (dir: string, prefix = '', out = new Set<string>()): Set<string> => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isFile()) out.add(rel);
    else if (e.isDirectory()) indexFiles(path.join(dir, e.name), rel, out);
  }
  return out;
};

export const serveBundle = (distDir: string): void => {
  const root = path.resolve(distDir);
  const files = indexFiles(root);
  const rootPrefix = `${root}${path.sep}`;
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const url = parseAppUrl(request.url);
    if (!url) return new Response('Not Found', { status: 404 });
    const resolved = resolveBundlePath(url.pathname, (rel) => files.has(rel));
    if ('status' in resolved) return new Response('Not Found', { status: resolved.status });
    const fullPath = path.resolve(root, resolved.file);
    if (!fullPath.startsWith(rootPrefix)) return new Response('Not Found', { status: 404 });
    const headers: Record<string, string> = {
      'Content-Type': contentType(path.basename(fullPath)) || 'application/octet-stream',
      ...(resolved.file.endsWith('.html') ? framingHeaders(url.pathname) : {}),
    };
    const body = request.method === 'HEAD' ? null : await fs.promises.readFile(fullPath);
    return new Response(body, { status: 200, headers });
  });
};
