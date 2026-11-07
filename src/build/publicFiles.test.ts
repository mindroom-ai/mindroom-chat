import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The build's files under /public/ (language catalogs, license texts) are only ever files, so a
// server answers a missing one with 404, never with the app shell: a page or frame that asks for
// such a file must not start another copy of the app. scripts/image-smoke-test.sh checks the same
// on the image's nginx (docker/default.conf).

const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const SHELL = '<!doctype html><title>app</title>';
const CATALOG = '{"nav":{"home":"Startseite"}}';

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

describe('serve.py', () => {
  // Starts Python and serve.py: well under a second, but over 5 s on a loaded machine.
  it('answers a missing file under /public/ with 404, and the files there and app routes as before', async () => {
    const root = mkdtempSync(join(tmpdir(), 'serve-py-public-'));
    writeFileSync(join(root, 'index.html'), SHELL);
    mkdirSync(join(root, 'public/locales'), { recursive: true });
    writeFileSync(join(root, 'public/locales/de.json'), CATALOG);
    const port = await freePort();
    const server = spawn('python3', [repoFile('serve.py'), String(port)], {
      cwd: root,
      stdio: 'ignore',
    });
    try {
      /** Status and body of a request, asked again until the server listens. */
      const answer = async (path: string, method = 'GET') => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
            // eslint-disable-next-line no-await-in-loop
            return { status: response.status, body: await response.text() };
          } catch (error) {
            if (attempt > 100) throw error;
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
              setTimeout(resolve, 100);
            });
          }
        }
      };
      expect((await answer('/public/missing.html')).status).toBe(404);
      expect(await answer('/public/missing.html', 'HEAD')).toEqual({ status: 404, body: '' });
      expect(await answer('/public/locales/de.json')).toEqual({ status: 200, body: CATALOG });
      expect(await answer('/home/')).toEqual({ status: 200, body: SHELL });
    } finally {
      server.kill();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('netlify.toml', () => {
  type Redirect = { from: string; to: string; status: number; force: boolean };

  /** The [[redirects]] rules, in their order. */
  const redirects: Redirect[] = [
    ...readFileSync(repoFile('netlify.toml'), 'utf8').matchAll(
      /^\[\[redirects\]\]\n((?:[ \t]+\S.*\n)+)/gm
    ),
  ].map(([, rule = '']) => {
    const value = (key: string) => new RegExp(`^\\s*${key} = (.+)$`, 'm').exec(rule)?.[1];
    return {
      from: JSON.parse(value('from') ?? '""') as string,
      to: JSON.parse(value('to') ?? '""') as string,
      status: Number(value('status')),
      force: value('force') === 'true',
    };
  });

  /**
   * The rule Netlify applies to a request: the first one whose `from` matches, where a rule that
   * is not forced never applies to a path that has a file (docs.netlify.com, "Shadowing").
   */
  const ruleFor = (path: string, { fileExists }: { fileExists: boolean }) =>
    redirects.find(
      ({ from, force }) =>
        (force || !fileExists) &&
        (from.endsWith('/*') ? path.startsWith(from.slice(0, -1)) : path === from)
    );

  it('answers a missing file under /public/ with 404, and the files there and app routes as before', () => {
    expect(ruleFor('/public/missing.html', { fileExists: false })?.status).toBe(404);
    expect(ruleFor('/public/locales/de.json', { fileExists: true })).toBeUndefined();
    expect(ruleFor('/home/', { fileExists: false })).toMatchObject({
      to: '/index.html',
      status: 200,
    });
  });
});
