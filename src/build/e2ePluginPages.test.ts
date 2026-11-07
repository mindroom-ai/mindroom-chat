import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, createServer, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pluginCopies,
  pluginDirectories,
  pluginDirectoryServer,
  pluginPageInputs,
} from '../../scripts/e2e-plugin-pages.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));

// A plugin directory outside this repository, as a plugin's author has it: one fixture page with an inline
// script, and a module that imports a package by name and a source of this repository from /src/.
let outside = '';
let plugin = '';
const writePlugin = (directory: string) => {
  const pages = path.join(directory, 'e2e', 'fixtures');
  mkdirSync(pages, { recursive: true });
  writeFileSync(
    path.join(pages, 'page.html'),
    [
      '<!doctype html><html><body>',
      '<script type="module">window.inlineMarker = "inline-page-marker";</script>',
      '<script type="module" src="./page.ts"></script>',
      '</body></html>',
    ].join('\n')
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
/** Gives a plugin directory its own installed copy of a package its page imports. */
const ownPackages = (directory: string) => {
  const classNames = path.join(directory, 'node_modules', 'classnames');
  mkdirSync(classNames, { recursive: true });
  writeFileSync(
    path.join(classNames, 'package.json'),
    JSON.stringify({ name: 'classnames', version: '0.0.1', main: 'index.js' })
  );
  writeFileSync(path.join(classNames, 'index.js'), 'module.exports = () => "own";');
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

describe('pluginPageInputs', () => {
  it('lists the copies of a snapshot', () => {
    const copy = writePlugin(path.join(outside, 'e2e-plugins', 'my-plugin'));
    expect(pluginCopies(outside)).toEqual([copy]);
    expect(pluginCopies(plugin)).toEqual([]);
  });

  it('builds the pages of each copy under an input name no other page has', () => {
    const copies = path.join(outside, 'e2e-plugins');
    writePlugin(path.join(copies, 'foo-bar'));
    const foo = path.join(copies, 'foo', 'e2e', 'fixtures');
    mkdirSync(foo, { recursive: true });
    writeFileSync(path.join(foo, 'bar-page.html'), '');
    mkdirSync(path.join(copies, 'no-pages'));
    expect(pluginPageInputs(outside)).toEqual({
      'plugin-foo-bar/page': path.join(copies, 'foo-bar', 'e2e', 'fixtures', 'page.html'),
      'plugin-foo/bar-page': path.join(foo, 'bar-page.html'),
    });
    expect(pluginPageInputs(plugin)).toEqual({});
  });
});

describe('pluginDirectoryServer', () => {
  it('refuses two directories of one name', () => {
    expect(() => pluginDirectoryServer([plugin, path.join(outside, 'twin', 'my-plugin')])).toThrow(
      'Two directories of E2E_PLUGIN_DIRS are named my-plugin'
    );
  });

  describe('on the dev server', () => {
    let vite: ViteDevServer;
    let http: Server;
    let origin = '';
    let errors: string[] = [];
    beforeEach(async () => {
      errors = [];
      vite = await createServer({
        configFile: false,
        root: repository,
        customLogger: {
          ...createLogger('silent'),
          error: (message) => {
            errors.push(message);
          },
        },
        plugins: [
          pluginDirectoryServer([
            plugin,
            writePlugin(path.join(outside, '50% off plugin')),
            ownPackages(writePlugin(path.join(outside, 'own-packages'))),
          ]),
        ],
        optimizeDeps: { noDiscovery: true },
        // No HMR socket: in middleware mode it takes a fixed port, which a parallel run may hold.
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
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

    it('serves a page, its inline script and its module, which imports from this repository', async () => {
      const page = await fetch(`${origin}/e2e-plugins/my-plugin/e2e/fixtures/page.html`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('text/html');
      const html = await page.text();
      expect(html).toContain('/@vite/client');

      const inline = /src="([^"]*html-proxy[^"]*)"/.exec(html)?.[1];
      expect(inline).toBeDefined();
      expect(await (await fetch(`${origin}${inline ?? ''}`)).text()).toContain(
        'inline-page-marker'
      );

      const module = await fetch(`${origin}/e2e-plugins/my-plugin/e2e/fixtures/page.ts`);
      expect(module.status).toBe(200);
      const code = await module.text();
      expect(code).toContain('plugin-page-marker');
      expect(code).toContain('/node_modules/classnames/');
      expect(code).toContain('/src/app/lib/isRecord.ts');

      writeFileSync(path.join(plugin, 'e2e', 'fixtures', 'data.json'), '{"from":"the plugin"}');
      const data = await fetch(`${origin}/e2e-plugins/my-plugin/e2e/fixtures/data.json`);
      expect(await data.json()).toEqual({ from: 'the plugin' });
      // Vite asked for the page's module ahead of the browser, and found it.
      expect(errors).toEqual([]);
    }, 30_000);

    it("resolves a package from the directory's own node_modules first", async () => {
      const code = await (
        await fetch(`${origin}/e2e-plugins/own-packages/e2e/fixtures/page.ts`)
      ).text();
      expect(code).toContain('/own-packages/node_modules/classnames/');
    }, 30_000);

    it('serves a directory whose name a URL escapes', async () => {
      const directory = `${origin}/e2e-plugins/50%25%20off%20plugin/e2e/fixtures`;
      expect(await (await fetch(`${directory}/page.html`)).text()).toContain('src="./page.ts"');
      expect(await (await fetch(`${directory}/page.ts`)).text()).toContain('plugin-page-marker');
    }, 30_000);

    it('serves nothing outside the plugin directories, nor to a host Vite refuses', async () => {
      writeFileSync(path.join(outside, 'outside.html'), '<p>outside the plugin</p>');
      // A raw path: a URL would resolve the dot segments before the request goes out.
      const raw = (requestPath: string, headers: Record<string, string> = {}) =>
        new Promise<string>((resolve, reject) => {
          const { port } = new URL(origin);
          get({ host: '127.0.0.1', port, path: requestPath, headers }, (response) => {
            let body = '';
            response.on('data', (part: Buffer) => {
              body += part.toString();
            });
            response.on('end', () => resolve(body));
          }).on('error', reject);
        });
      expect(await raw('/e2e-plugins/my-plugin/../outside.html')).not.toContain(
        'outside the plugin'
      );
      // A file that is not there is left to the app.
      expect(await raw('/e2e-plugins/my-plugin/missing.html')).toContain('/src/index.tsx');
      // A page that another site's name points at this server (DNS rebinding) does not get.
      const page = '/e2e-plugins/my-plugin/e2e/fixtures/page.html';
      expect(await raw(page, { host: 'attacker.example' })).toContain('Blocked request');
    }, 30_000);
  });
});
