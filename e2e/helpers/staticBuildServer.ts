import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

/** The production build that `scripts/e2e-slot.sh --preview` serves, read from its command. */
export const previewBuildDir = (): string | undefined =>
  process.env.E2E_SERVER_COMMAND?.match(/--outDir (\S+)/)?.[1];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves a production build as a static deployment does: the hashed files under assets/ cached
 * for a year and sent uncompressed, everything else revalidated, app routes answered with
 * index.html. `vite preview` compresses every response, which changes how the browser's HTTP
 * cache stores a large file such as the 7.8 MB crypto wasm.
 */
export const serveBuild = async (
  directory: string
): Promise<{ origin: string; close: () => Promise<void> }> => {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const asset = path.startsWith('/assets/');
    const answer = async () => {
      let file = join(directory, path);
      if (!(await stat(file).catch(() => undefined))?.isFile()) {
        if (asset) {
          response.writeHead(404).end();
          return;
        }
        file = join(directory, 'index.html');
      }
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      response.end(body);
    };
    answer().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
