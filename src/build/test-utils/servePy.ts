import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SERVE_PY = fileURLToPath(new URL('../../../scripts/serve.py', import.meta.url));

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

/**
 * Runs scripts/serve.py over a temporary directory holding `files` (path: content) and hands `use` a fetch
 * on it, which asks again until the server listens: Python starts in well under a second, but
 * over 5 s on a loaded machine, so a test that uses this gets 30 s.
 */
export const withServePy = async (
  files: Record<string, string>,
  use: (request: (path: string, init?: RequestInit) => Promise<Response>) => Promise<void>
): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'serve-py-'));
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  });
  const port = await freePort();
  const server = spawn('python3', [SERVE_PY, String(port)], { cwd: root, stdio: 'ignore' });
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetch(`http://127.0.0.1:${port}${path}`, init);
      } catch (error) {
        if (attempt > 100) throw error;
        await delay(100);
      }
    }
  };
  try {
    await use(request);
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
};
