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
 * cache stores a large file such as the 7.8 MB crypto wasm. `publishedVersion`, when it answers,
 * replaces the build's version.json, as a deployment of another build would. `directory` may be a
 * function, asked on every request, so a test can deploy another build in its place.
 * `immutable` picks the paths sent with a year-long `immutable` cache header (by default the hashed
 * files under assets/), so a test can serve a deployment that caches more than those.
 * config.json goes out with the recovery password start prompt off, as the e2e dev and preview
 * servers send it (scripts/e2e-client-config.mjs), so the prompt covers no fresh account's page; a
 * spec that tests the prompt turns it on with a route of its own.
 */
export const serveBuild = async (
  directory: string | (() => string),
  {
    publishedVersion,
    immutable = (path: string) => path.startsWith('/assets/'),
  }: {
    publishedVersion?: () => string | undefined;
    immutable?: (path: string) => boolean;
  } = {}
): Promise<{ origin: string; close: () => Promise<void> }> => {
  const servedDirectory = typeof directory === 'string' ? () => directory : directory;
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const asset = path.startsWith('/assets/');
    const deployed = path === '/version.json' ? publishedVersion?.() : undefined;
    if (deployed !== undefined) {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ version: deployed }));
      return;
    }
    const root = servedDirectory();
    const answer = async () => {
      let file = join(root, path);
      if (!(await stat(file).catch(() => undefined))?.isFile()) {
        if (asset) {
          response.writeHead(404).end();
          return;
        }
        file = join(root, 'index.html');
      }
      let body: Buffer | string = await readFile(file);
      if (file === join(root, 'config.json')) {
        const config = JSON.parse(body.toString()) as { encryptionRecovery?: object };
        body = JSON.stringify({
          ...config,
          encryptionRecovery: { ...config.encryptionRecovery, promptAtStart: false },
        });
      }
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': immutable(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
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
