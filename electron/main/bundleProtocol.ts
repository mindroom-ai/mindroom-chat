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
    const url = new URL(raw);
    if (
      url.protocol === `${APP_SCHEME}:` &&
      url.host === 'localhost' &&
      url.username === '' &&
      url.password === ''
    ) {
      return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const resolveBundlePath = (
  pathname: string,
  isFile: (relative: string) => boolean
): { file: string } | { status: 404 } => {
  const raw = pathname.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { status: 404 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 404 };
  const parts = decoded.split('/');
  if (parts.some((part) => part === '.' || part === '..')) return { status: 404 };
  const segments = parts.filter(Boolean);
  if (segments.length === 0) return { file: 'index.html' };
  const relative = segments.join('/');
  if (!decoded.endsWith('/') && isFile(relative)) return { file: relative };
  const first = segments[0] ?? '';
  if (first === 'assets' || first.startsWith('_capacitor_')) return { status: 404 };
  return { file: 'index.html' };
};

const isFrameFile = (relative: string): boolean => FRAME_PAGE_FILES.includes(relative);

export const isFramePage = (pathname: string): boolean => {
  const resolved = resolveBundlePath(pathname, isFrameFile);
  return 'file' in resolved && FRAME_PAGE_FILES.includes(resolved.file);
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

const isExactBundleFile = (rootDir: string, relative: string): boolean => {
  const parts = relative.split('/');
  let current = rootDir;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return false;
    }
    const match = entries.find((entry) => entry.name === part);
    if (!match) return false;
    if (i === parts.length - 1) return match.isFile();
    if (!match.isDirectory()) return false;
    current = path.join(current, part);
  }
  return false;
};

export const serveBundle = (distDir: string): void => {
  const root = path.resolve(distDir);
  const rootPrefix = `${root}${path.sep}`;
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const url = parseAppUrl(request.url);
    if (!url) return new Response('Not Found', { status: 404 });
    const pathname = request.url.startsWith(`${APP_ORIGIN}/`)
      ? (request.url.slice(APP_ORIGIN.length).split(/[?#]/, 1)[0] ?? url.pathname)
      : url.pathname;
    const resolved = resolveBundlePath(pathname, (rel) => isExactBundleFile(root, rel));
    if ('status' in resolved) return new Response('Not Found', { status: resolved.status });
    const fullPath = path.resolve(root, resolved.file);
    if (!fullPath.startsWith(rootPrefix)) return new Response('Not Found', { status: 404 });
    const body = await fs.promises.readFile(fullPath);
    const headers: Record<string, string> = {
      'Content-Type': contentType(path.basename(fullPath)) || 'application/octet-stream',
      ...(resolved.file.endsWith('.html') ? framingHeaders(url.pathname) : {}),
    };
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  });
};
