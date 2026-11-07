import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type Rollup, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pluginDirectories,
  pluginPageInputs,
  pluginPages,
} from '../../scripts/e2e-plugin-pages.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));

// A plugin directory outside this repository, as a plugin's author has it: one fixture page whose module
// imports a package by name and a source of this repository from /src/.
let outside = '';
let plugin = '';
const writePlugin = (directory: string) => {
  const pages = path.join(directory, 'e2e', 'fixtures');
  mkdirSync(pages, { recursive: true });
  writeFileSync(
    path.join(pages, 'page.html'),
    '<!doctype html><html><body><script type="module" src="./page.ts"></script></body></html>'
  );
  writeFileSync(
    path.join(pages, 'page.ts'),
    [
      "import classNames from 'classnames';",
      "import { isRecord } from '/src/app/lib/isRecord.ts';",
      "document.body.className = classNames('plugin-page-marker', { record: isRecord({}) });",
    ].join('\n')
  );
  return directory;
};
beforeEach(() => {
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'e2e-plugin-pages-')));
  plugin = writePlugin(path.join(outside, 'my-plugin'));
});
afterEach(() => rmSync(outside, { recursive: true, force: true }));

describe('pluginDirectories', () => {
  it('reads E2E_PLUGIN_DIRS like PATH, relative to the repository', () => {
    expect(pluginDirectories(undefined, repository)).toEqual([]);
    expect(
      pluginDirectories(`e2e/fixtures/sample-plugin${path.delimiter}${plugin}`, repository)
    ).toEqual([path.join(repository, 'e2e/fixtures/sample-plugin'), plugin]);
  });

  it('names each directory by its real path, as Vite names the modules in it', () => {
    const link = path.join(outside, 'linked-plugin');
    symlinkSync(plugin, link);
    expect(pluginDirectories(link, repository)).toEqual([plugin]);
  });

  it('refuses a directory that is not there', () => {
    expect(() => pluginDirectories(path.join(outside, 'missing'), repository)).toThrow(
      `E2E_PLUGIN_DIRS names ${path.join(outside, 'missing')}, which is not a directory`
    );
  });
});

describe('pluginPages', () => {
  it('builds each page at its URL, under an input name no other page has', () => {
    const fooBar = path.join(outside, 'foo-bar');
    const foo = path.join(outside, 'foo');
    mkdirSync(path.join(fooBar, 'e2e', 'fixtures'), { recursive: true });
    mkdirSync(path.join(foo, 'e2e', 'fixtures'), { recursive: true });
    writeFileSync(path.join(fooBar, 'e2e', 'fixtures', 'page.html'), '');
    writeFileSync(path.join(foo, 'e2e', 'fixtures', 'bar-page.html'), '');
    expect(pluginPageInputs([plugin, fooBar, foo])).toEqual({
      'plugin-my-plugin/page': '/e2e/plugins/my-plugin/page.html',
      'plugin-foo-bar/page': '/e2e/plugins/foo-bar/page.html',
      'plugin-foo/bar-page': '/e2e/plugins/foo/bar-page.html',
    });
  });

  it('refuses two directories of one name', () => {
    const twin = path.join(outside, 'twin', 'my-plugin');
    mkdirSync(twin, { recursive: true });
    expect(() => pluginPages([plugin, twin])).toThrow(
      'Two directories of E2E_PLUGIN_DIRS are named my-plugin'
    );
  });

  describe('on the dev server', () => {
    let vite: ViteDevServer;
    let http: Server;
    let origin = '';
    beforeEach(async () => {
      vite = await createServer({
        configFile: false,
        root: repository,
        logLevel: 'silent',
        plugins: [pluginPages([plugin, writePlugin(path.join(outside, '50% off plugin'))])],
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true, hmr: false, watch: null },
      });
      http = createHttpServer(vite.middlewares);
      await new Promise<void>((resolve) => {
        http.listen(0, '127.0.0.1', resolve);
      });
      origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    });
    afterEach(async () => {
      await new Promise((resolve) => {
        http.close(resolve);
      });
      await vite.close();
    });

    it('serves a page and its module, which imports from this repository', async () => {
      const page = await fetch(`${origin}/e2e/plugins/my-plugin/page.html`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('text/html');
      const html = await page.text();
      expect(html).toContain('/@vite/client');
      expect(html).toContain('src="./page.ts"');

      const module = await fetch(`${origin}/e2e/plugins/my-plugin/page.ts`);
      expect(module.status).toBe(200);
      const code = await module.text();
      expect(code).toContain('plugin-page-marker');
      expect(code).toContain('/node_modules/classnames/');
      expect(code).toContain('/src/app/lib/isRecord.ts');

      writeFileSync(path.join(plugin, 'e2e', 'fixtures', 'data.json'), '{"from":"the plugin"}');
      const data = await fetch(`${origin}/e2e/plugins/my-plugin/data.json`);
      expect(await data.json()).toEqual({ from: 'the plugin' });
    });

    it('serves a directory whose name a URL escapes', async () => {
      const page = await fetch(`${origin}/e2e/plugins/50%25%20off%20plugin/page.html`);
      expect(await page.text()).toContain('src="./page.ts"');
      const module = await fetch(`${origin}/e2e/plugins/50%25%20off%20plugin/page.ts`);
      expect(await module.text()).toContain('plugin-page-marker');
    });

    it('serves nothing outside the fixture pages', async () => {
      writeFileSync(path.join(plugin, 'e2e', 'outside.html'), '<p>outside the pages</p>');
      // A raw path: a URL would resolve the dot segments before the request goes out.
      const raw = (requestPath: string) =>
        new Promise<string>((resolve, reject) => {
          get({ host: '127.0.0.1', port: new URL(origin).port, path: requestPath }, (response) => {
            let body = '';
            response.on('data', (part: Buffer) => {
              body += part.toString();
            });
            response.on('end', () => resolve(body));
          }).on('error', reject);
        });
      expect(await raw('/e2e/plugins/my-plugin/../outside.html')).not.toContain(
        'outside the pages'
      );
      expect(await raw('/e2e/plugins/my-plugin/missing.html')).not.toContain('page.ts');
    });
  });

  it('writes a built page to its URL', async () => {
    writeFileSync(
      path.join(plugin, 'e2e', 'fixtures', 'query.html'),
      '<!doctype html><html><body><script type="module" src="./page.ts?v=1"></script></body></html>'
    );
    const result = (await build({
      configFile: false,
      root: repository,
      logLevel: 'silent',
      plugins: [pluginPages([plugin])],
      build: {
        write: false,
        outDir: path.join(outside, 'dist'),
        rollupOptions: { input: pluginPageInputs([plugin]) },
      },
    })) as Rollup.RollupOutput;
    const files = new Map(result.output.map((file) => [file.fileName, file]));
    const page = files.get('e2e/plugins/my-plugin/page.html');
    expect(page?.type).toBe('asset');
    const script = /src="\/(assets\/[^"]+\.js)"/.exec(
      page?.type === 'asset' ? String(page.source) : ''
    )?.[1];
    const chunk = script === undefined ? undefined : files.get(script);
    expect(chunk?.type === 'chunk' ? chunk.code : '').toContain('plugin-page-marker');
    // A module the page asks for with a query is found too.
    expect(files.get('e2e/plugins/my-plugin/query.html')?.type).toBe('asset');
  }, 60_000);
});
