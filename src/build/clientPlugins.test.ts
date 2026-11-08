import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  build,
  createServer,
  optimizeDeps,
  resolveConfig,
  type Plugin,
  type Rollup,
  type ServerOptions,
  type UserConfig,
} from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { clientPlugins, pluginOwner, readClientPlugins } from '../../scripts/client-plugins.mjs';
import { onePackageCopyPerVersion } from '../../scripts/package-copies.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLE = path.join(ROOT, 'src/app/plugins/__fixtures__/example-plugin');
const ENTRIES = path.join(ROOT, 'src/app/plugins/pluginEntries.ts');
const APP_IMPORTS = path.join(ROOT, 'src/build/__fixtures__/appImports.ts');

/** The output of an in-memory build of the entries module and `inputs`, with these build variables. */
const buildOutput = async (
  env: Record<string, string | undefined>,
  { inputs = [], external }: { inputs?: string[]; external?: (id: string) => boolean } = {}
) => {
  const output = (await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'silent',
    plugins: [clientPlugins(env)],
    build: {
      write: false,
      minify: false,
      rollupOptions: { input: [ENTRIES, ...inputs], preserveEntrySignatures: 'strict', external },
    },
  })) as Rollup.RollupOutput;
  return output.output;
};

/** The chunks of an in-memory build of the entries module and `inputs`, with these build variables. */
const buildEntries = async (...args: Parameters<typeof buildOutput>) =>
  (await buildOutput(...args)).flatMap((file) => (file.type === 'chunk' ? [file] : []));

/** The code of an in-memory build of the entries module and `inputs`, with these build variables. */
const buildCode = async (...args: Parameters<typeof buildOutput>) =>
  (await buildEntries(...args)).map((chunk) => chunk.code).join('\n');

/** The modules a build of the plugins MINDROOM_CLIENT_PLUGINS (`list`) names and `inputs` bundles. */
const bundlePlugin = async (list: string, inputs: string[] = []) =>
  (await buildEntries({ MINDROOM_CLIENT_PLUGINS: list }, { inputs })).flatMap((chunk) =>
    Object.keys(chunk.modules)
  );

/**
 * A dev server with the plugins MINDROOM_CLIENT_PLUGINS (`plugins`) lists and these server options,
 * without pre-bundling.
 */
const devServer = (plugins?: string, server: ServerOptions = { middlewareMode: true }) =>
  createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    plugins: [clientPlugins({ MINDROOM_CLIENT_PLUGINS: plugins })],
    server: { ...server, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });

/** Packages, which builds that check the entries module and the plugins' own files leave out. */
const packages = (id: string) =>
  !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0');

const madeDirs: string[] = [];
afterAll(() => madeDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A new, empty directory, removed after the tests. */
const emptyDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'client-plugin-'));
  madeDirs.push(dir);
  return dir;
};

/** A new plugin directory with this package.json (raw text when a string) and an index.js entry. */
const pluginDir = (manifest: unknown, { entry = true } = {}): string => {
  const dir = emptyDir();
  writeFileSync(
    path.join(dir, 'package.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  );
  if (entry) writeFileSync(path.join(dir, 'index.js'), 'export default {};\n');
  return dir;
};

/** Writes `files` (path in `dir` to text) into `dir`. */
const writeFiles = (dir: string, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
};

const declaring = (fields: Record<string, unknown> = {}) => ({
  name: 'some-plugin',
  version: '2.0.0',
  mindroomClientPlugin: { id: 'some-plugin', apiVersion: 1, entry: './index.js', ...fields },
});

describe('readClientPlugins', () => {
  it('lists none when MINDROOM_CLIENT_PLUGINS is unset or blank', () => {
    expect(readClientPlugins(undefined)).toEqual([]);
    expect(readClientPlugins('')).toEqual([]);
    expect(readClientPlugins(' , ')).toEqual([]);
  });

  it('reads the id, version, entry and build module of each listed directory, in order', () => {
    // The example needs a later client SDK; the other was written for 1, which this client still
    // builds.
    const other = pluginDir(declaring());
    expect(readClientPlugins(` ${EXAMPLE} ,${other},`)).toEqual([
      {
        id: 'example',
        version: '1.0.0',
        dir: EXAMPLE,
        entry: path.join(EXAMPLE, 'index.tsx'),
        build: path.join(EXAMPLE, 'build.mjs'),
      },
      { id: 'some-plugin', version: '2.0.0', dir: other, entry: path.join(other, 'index.js') },
    ]);
  });

  it.each([
    [
      'a relative directory',
      () => 'plugins/example',
      /plugins\/example: not an absolute directory/,
    ],
    ['a directory without package.json', emptyDir, /cannot read package\.json/],
    ['a package.json that does not parse', () => pluginDir('{'), /cannot read package\.json/],
    [
      'a package.json without the declaration',
      () => pluginDir({ name: 'some-plugin', version: '2.0.0' }),
      /declares no "mindroomClientPlugin"/,
    ],
    [
      'an id that is not kebab-case',
      () => pluginDir(declaring({ id: 'Some_Plugin' })),
      /id "Some_Plugin" is not kebab-case/,
    ],
    [
      'a plugin that needs a newer client SDK',
      () => pluginDir(declaring({ apiVersion: 29 })),
      /plugin "some-plugin" needs client SDK apiVersion 29; this client provides 28/,
    ],
    [
      'an apiVersion that is not a number',
      () => pluginDir(declaring({ apiVersion: '2' })),
      /apiVersion "2" is not a positive whole number/,
    ],
    [
      'an apiVersion of 0',
      () => pluginDir(declaring({ apiVersion: 0 })),
      /apiVersion 0 is not a positive whole number/,
    ],
    [
      'an entry that does not exist',
      () => pluginDir(declaring(), { entry: false }),
      /entry "\.\/index\.js" does not exist/,
    ],
    [
      'a build module that does not exist',
      () => pluginDir(declaring({ build: './build.mjs' })),
      /build "\.\/build\.mjs" does not exist/,
    ],
    [
      'a build module outside its directory',
      () => {
        const elsewhere = path.join(emptyDir(), 'build.mjs');
        writeFileSync(elsewhere, 'export default [];\n');
        return pluginDir(declaring({ build: elsewhere }));
      },
      /build ".+\/build\.mjs" is outside the plugin's directory/,
    ],
    [
      'a package the app shares under dependencies',
      () => pluginDir({ ...declaring(), dependencies: { jotai: '^2.0.0' } }),
      /plugin "some-plugin" lists jotai under dependencies/,
    ],
    [
      'a package.json without a version',
      () => pluginDir({ ...declaring(), version: undefined }),
      /package\.json has no "version"/,
    ],
  ])('fails the build for %s', (_case, listed, reason) => {
    const list = listed();
    expect(() => readClientPlugins(list)).toThrow(/^MINDROOM_CLIENT_PLUGINS: /);
    expect(() => readClientPlugins(list)).toThrow(reason);
  });

  it('fails the build for an id two directories share, naming both', () => {
    const first = pluginDir(declaring());
    const second = pluginDir(declaring());
    expect(() => readClientPlugins(`${first},${second}`)).toThrow(
      `MINDROOM_CLIENT_PLUGINS: ${second}: id "some-plugin" is also the id of ${first}`
    );
  });
});

describe('clientPlugins', () => {
  it('builds each listed plugin into the entries module', async () => {
    const code = await buildCode({ MINDROOM_CLIENT_PLUGINS: EXAMPLE }, { external: packages });
    expect(code).toContain('com.example.greeting');
    expect(code).toMatch(/id: "example",\s*version: "1\.0\.0"/);
    // Its build module (build.mjs) writes its banner's words in place of their marker.
    expect(code).toContain('Example banner in');
    expect(code).not.toContain('EXAMPLE_BANNER');
  });

  it('lets the dev server serve the plugin directories besides the workspace', () => {
    const config = (plugins: string | undefined) => {
      const [, app] = clientPlugins({ MINDROOM_CLIENT_PLUGINS: plugins }) as [unknown, Plugin];
      return (app.config as () => UserConfig)();
    };
    expect(config(EXAMPLE).server?.fs?.allow).toEqual([path.resolve(ROOT), EXAMPLE]);
    expect(config(undefined).server).toBeUndefined();
  });

  it('resolves the client SDK for a plugin outside this repository', async () => {
    const dir = pluginDir(declaring({ apiVersion: 24 }), { entry: false });
    writeFileSync(
      path.join(dir, 'index.js'),
      "import { usePluginConfig } from '@mindroom/client-sdk/core';\n" +
        "import { useRoomMembers } from '@mindroom/client-sdk/matrix';\n" +
        "import { MenuEntry } from '@mindroom/client-sdk/ui';\n" +
        'export default { messageRenderers: [], usePluginConfig, useRoomMembers, MenuEntry };\n'
    );
    const chunks = await buildEntries(
      { MINDROOM_CLIENT_PLUGINS: dir },
      // Packages, such as the Matrix SDK the `matrix` subpath imports, stay out; the SDK stays in.
      { external: (id) => packages(id) && !id.startsWith('@mindroom/client-sdk/') }
    );
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));
    // The SDK's exports are the app's own modules, not copies or stand-ins.
    expect(modules).toContain(path.join(ROOT, 'src/app/plugins/pluginConfig.ts'));
    expect(modules).toContain(path.join(ROOT, 'src/app/matrix/hooks/useRoomMembers.ts'));
    expect(modules).toContain(path.join(ROOT, 'src/app/ui/MenuEntry.tsx'));
  });

  it('ships no plugin code without plugins', async () => {
    const code = await buildCode({}, { external: packages });
    expect(code).not.toContain('com.example.greeting');
    expect(code).toMatch(/pluginEntries = \[\]/);
  });

  it('builds a plugin that installed its own copy of a package the app bundles too', async () => {
    // The plugin's own copy of linkifyjs, a dependency of the app, in the version the app installed.
    const appCopy = path.join(ROOT, 'node_modules/linkifyjs');
    const { version, module: entry } = JSON.parse(
      readFileSync(path.join(appCopy, 'package.json'), 'utf8')
    ) as { version: string; module: string };
    const own = pluginDir(declaring(), { entry: false });
    cpSync(appCopy, path.join(own, 'node_modules/linkifyjs'), { recursive: true });
    writeFileSync(
      path.join(own, 'index.js'),
      "import { find } from 'linkifyjs';\nexport default { messageRenderers: [], find };\n"
    );
    const bundle = (pluginDirs: string[]) =>
      build({
        configFile: false,
        root: ROOT,
        publicDir: false,
        logLevel: 'silent',
        plugins: [
          clientPlugins({ MINDROOM_CLIENT_PLUGINS: own }),
          onePackageCopyPerVersion(pluginDirs),
        ],
        build: {
          write: false,
          rollupOptions: {
            // The plugin's entries and the app's own linkifyjs.
            input: [ENTRIES, path.join(appCopy, entry)],
            preserveEntrySignatures: 'strict',
          },
        },
      });
    // Two copies of one linkifyjs version are bundled; the plugin's own counts as the plugin's.
    await expect(bundle([own])).resolves.toBeDefined();
    await expect(bundle([])).rejects.toThrow(`linkifyjs@${version}`);
  });
});

describe("a plugin's public/ directory", () => {
  /** The files a build with these build variables writes under public/plugins/, as text. */
  const publicFilesBuilt = async (env: Record<string, string | undefined>) =>
    Object.fromEntries(
      (await buildOutput(env, { external: packages })).flatMap((file) =>
        file.type === 'asset' && file.fileName.startsWith('public/plugins/')
          ? [[file.fileName, Buffer.from(file.source).toString()]]
          : []
      )
    );

  it('ships under public/plugins/<id>/ of the build, one directory per plugin', async () => {
    const other = pluginDir(declaring());
    writeFiles(other, { 'public/page.html': '<p>A page</p>', 'public/fonts/a.woff2': 'font' });
    const bare = pluginDir(declaring({ id: 'bare' }));
    expect(
      await publicFilesBuilt({ MINDROOM_CLIENT_PLUGINS: `${EXAMPLE},${other},${bare}` })
    ).toEqual({
      'public/plugins/example/mark.svg': readFileSync(
        path.join(EXAMPLE, 'public/mark.svg'),
        'utf8'
      ),
      'public/plugins/some-plugin/page.html': '<p>A page</p>',
      'public/plugins/some-plugin/fonts/a.woff2': 'font',
    });
    expect(await publicFilesBuilt({})).toEqual({});
  });

  it.each([
    ['in it', 'public/outside', 'neither a file nor a directory'],
    ['as the directory itself', 'public', 'not a directory'],
  ])('fails the build for a symbolic link %s, naming it', async (_case, link, what) => {
    const dir = pluginDir(declaring());
    mkdirSync(path.join(dir, path.dirname(link)), { recursive: true });
    symlinkSync(emptyDir(), path.join(dir, link));
    await expect(publicFilesBuilt({ MINDROOM_CLIENT_PLUGINS: dir })).rejects.toThrow(
      `MINDROOM_CLIENT_PLUGINS: ${dir}: ${link} is ${what}`
    );
  });

  it('is served by the dev server as it is, at the same paths, anything else there as a 404', async () => {
    const dir = pluginDir(declaring());
    const files = {
      'sub/page.html': ['<p>A page</p>', 'text/html; charset=utf-8'],
      'worker.js': [
        "self.onmessage = () => postMessage('ok');\n",
        'application/javascript; charset=utf-8',
      ],
      'C#-guide.txt': ['A guide', 'text/plain; charset=utf-8'],
    };
    writeFiles(dir, {
      ...Object.fromEntries(
        Object.entries(files).map(([name, [text]]) => [`public/${name}`, text])
      ),
      'secret.txt': 'secret',
    });
    const vite = await devServer(dir, { host: '127.0.0.1', port: 0 });
    await vite.listen();
    const { port } = vite.httpServer!.address() as AddressInfo;
    const get = (pathname: string) => fetch(`http://127.0.0.1:${port}${pathname}`);
    try {
      for (const [name, [text, type]] of Object.entries(files)) {
        const response = await get(
          `/public/plugins/some-plugin/${name.split('/').map(encodeURIComponent).join('/')}`
        );
        expect(response.status, name).toBe(200);
        expect(response.headers.get('content-type'), name).toBe(type);
        expect(await response.text(), name).toBe(text);
      }
      for (const missing of [
        '/public/plugins/some-plugin/sub/missing.html',
        '/public/plugins/some-plugin/..%2fsecret.txt',
        '/public/plugins/some-plugin/sub/%E0.html',
        '/public/plugins/other/sub/page.html',
      ]) {
        expect((await get(missing)).status, missing).toBe(404);
      }
      // Every other path is Vite's.
      expect(await (await get('/index.html')).text()).toContain('<div id="root"');
    } finally {
      await vite.close();
    }
  });
});

describe('packages the app shares with plugins', () => {
  /** Writes index.js in `dir`, importing each of `sources`. */
  const importing = (dir: string, sources: string[]) =>
    writeFileSync(
      path.join(dir, 'index.js'),
      `${sources
        .map((source, i) => `import * as m${i} from ${JSON.stringify(source)};`)
        .join('\n')}\nexport default { messageRenderers: [], ${sources
        .map((_, i) => `m${i}`)
        .join(', ')} };\n`
    );

  /** Installs a package named `name` (a stand-in, not the real one) in `base`'s node_modules. */
  const installStandIn = (base: string, name: string, code = 'export const own = true;\n') => {
    const dir = path.join(base, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version: '0.0.1', main: 'index.js' })
    );
    writeFileSync(path.join(dir, 'index.js'), code);
  };

  /** The app's installed copy of `name`, as module ids start with it. */
  const appCopy = (name: string) => `${realpathSync(path.join(ROOT, 'node_modules', name))}/`;

  it("resolves them to the app's copy for a plugin outside the app that installed none", async () => {
    const dir = pluginDir(declaring(), { entry: false });
    importing(dir, ['jotai']);
    const modules = await bundlePlugin(dir);
    expect(modules.some((id) => id.startsWith(appCopy('jotai')))).toBe(true);
  });

  it("resolves them to the app's copy over copies the plugin and its packages installed", async () => {
    const dir = pluginDir(declaring(), { entry: false });
    importing(dir, ['jotai', 'helper']);
    // jotai installed for the plugin's own tests, and a package with its own TanStack Query.
    installStandIn(dir, 'jotai');
    installStandIn(dir, 'helper', "export * as query from '@tanstack/react-query';\n");
    installStandIn(path.join(dir, 'node_modules/helper'), '@tanstack/react-query');
    // Listed by a link to its directory: module ids are real paths.
    const link = path.join(emptyDir(), 'plugin');
    symlinkSync(dir, link);
    const modules = await bundlePlugin(link);
    expect(modules.some((id) => id.startsWith(appCopy('jotai')))).toBe(true);
    expect(modules.some((id) => id.startsWith(appCopy('@tanstack/react-query')))).toBe(true);
    const ownCopies = `${realpathSync(dir)}/node_modules/`;
    expect(modules.filter((id) => id.startsWith(ownCopies))).toEqual([
      `${ownCopies}helper/index.js`,
    ]);
  });

  it("resolves react-aria to the app's copy over the one the plugin installed", async () => {
    const dir = pluginDir(declaring(), { entry: false });
    importing(dir, ['react-aria/usePreventScroll']);
    // A copy of its own would keep its own scroll lock, overlay stack and focus scopes.
    installStandIn(dir, 'react-aria');
    writeFileSync(path.join(dir, 'node_modules/react-aria/usePreventScroll.js'), 'export {};\n');
    const modules = await bundlePlugin(dir);
    expect(modules.some((id) => id.startsWith(appCopy('react-aria')))).toBe(true);
    expect(modules.filter((id) => id.startsWith(`${realpathSync(dir)}/node_modules/`))).toEqual([]);
  });

  it("fails the build for an import the app's copy cannot resolve, naming the plugin and the import", async () => {
    const dir = pluginDir(declaring(), { entry: false });
    importing(dir, ['dayjs/esm/only-in-the-plugin.js']);
    installStandIn(dir, 'dayjs');
    mkdirSync(path.join(dir, 'node_modules/dayjs/esm'));
    writeFileSync(path.join(dir, 'node_modules/dayjs/esm/only-in-the-plugin.js'), 'export {};\n');
    await expect(bundlePlugin(dir)).rejects.toThrow(
      `MINDROOM_CLIENT_PLUGINS: ${dir}: index.js imports dayjs/esm/only-in-the-plugin.js, which the app's dayjs does not have`
    );
  });

  it("gives a plugin's CommonJS package the builds of the shared packages the app imports", async () => {
    const dir = pluginDir(declaring(), { entry: false });
    importing(dir, ['helper']);
    installStandIn(
      dir,
      'helper',
      "module.exports = [require('jotai'), require('@tanstack/react-query')];\n"
    );
    const modules = await bundlePlugin(dir, [APP_IMPORTS]);
    expect(modules).toContain(`${realpathSync(dir)}/node_modules/helper/index.js`);
    // One build of each, the module the app imports: a second build would be a second copy.
    for (const copy of [appCopy('jotai'), appCopy('@tanstack/react-query')]) {
      const builds = modules.filter((id) => id.startsWith(copy)).map((id) => path.extname(id));
      expect(builds.length).toBeGreaterThan(0);
      expect(new Set(builds).size).toBe(1);
    }
  });

  it("lets a plugin's build module put a module of its own in place of one, whose import of it gets the app's", async () => {
    const dir = realpathSync(pluginDir(declaring({ build: './build.mjs' }), { entry: false }));
    importing(dir, ['bundle']);
    // An installed bundle that reads jotai's names, and the plugin's own jotai, for its tests.
    installStandIn(dir, 'bundle', "import * as jotai from 'jotai';\nexport const names = jotai;\n");
    installStandIn(dir, 'jotai');
    const substitute = path.join(dir, 'jotai-atom.js');
    writeFileSync(substitute, "export { atom } from 'jotai';\n");
    writeFileSync(
      path.join(dir, 'build.mjs'),
      `const substitute = ${JSON.stringify(substitute)};\n` +
        "export default { name: 'jotai-atom', enforce: 'pre', resolveId: (source, importer) =>\n" +
        "  source === 'jotai' && importer !== substitute ? substitute : null };\n"
    );
    const modules = await bundlePlugin(dir);
    expect(modules).toContain(substitute);
    expect(modules.some((id) => id.startsWith(appCopy('jotai')))).toBe(true);
    expect(modules.filter((id) => id.startsWith(`${dir}/node_modules/jotai/`))).toEqual([]);
  });

  it('leaves the imports of files outside the plugins as they were', async () => {
    const plugin = pluginDir(declaring());
    const outside = realpathSync(emptyDir());
    installStandIn(outside, 'jotai');
    importing(outside, ['jotai']);
    const modules = await bundlePlugin(plugin, [path.join(outside, 'index.js')]);
    expect(modules).toContain(path.join(outside, 'node_modules/jotai/index.js'));
  });

  it("resolves them to the app's copy in the dev server too, for a plugin's own files", async () => {
    const dir = realpathSync(pluginDir(declaring(), { entry: false }));
    importing(dir, ['jotai', 'helper']);
    installStandIn(dir, 'jotai');
    installStandIn(dir, 'helper');
    const server = await devServer(dir);
    try {
      const index = path.join(dir, 'index.js');
      const resolved = await server.pluginContainer.resolveId('jotai', index);
      expect(resolved?.id.startsWith(appCopy('jotai'))).toBe(true);
      // Its other imports resolve in its own directory.
      expect((await server.pluginContainer.resolveId('helper', index))?.id).toBe(
        path.join(dir, 'node_modules/helper/index.js')
      );
    } finally {
      await server.close();
    }
  });

  it("gives the packages a plugin installed, as the dev server pre-bundles them, the module the app's pre-bundle has", async () => {
    const dir = realpathSync(pluginDir(declaring(), { entry: false }));
    importing(dir, ['jotai', 'helper', 'required']);
    installStandIn(dir, 'jotai', 'export const pluginsOwnJotai = true;\n');
    installStandIn(dir, 'helper', "export * from 'jotai';\n");
    installStandIn(dir, 'required', "module.exports = require('jotai');\n");
    const config = await resolveConfig(
      {
        configFile: false,
        root: ROOT,
        logLevel: 'silent',
        cacheDir: emptyDir(),
        plugins: [clientPlugins({ MINDROOM_CLIENT_PLUGINS: dir })],
        optimizeDeps: { entries: [path.join(dir, 'index.js')] },
      },
      'serve'
    );
    expect(Object.keys((await optimizeDeps(config, true)).optimized).sort()).toEqual([
      'helper',
      'jotai',
      'required',
    ]);
    const deps = path.join(config.cacheDir, 'deps');
    const code = readdirSync(deps)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(path.join(deps, name), 'utf8'));
    // One jotai for the three, the app's ES module: its CommonJS build in `required` would be a
    // second one, and the plugin's own copy a third.
    expect(code.filter((text) => text.includes('keyCount'))).toHaveLength(1);
    expect(code.filter((text) => text.includes('pluginsOwnJotai'))).toEqual([]);
  });

  it('leaves the imports of files outside the plugins as they were in the dev server', async () => {
    const plugin = pluginDir(declaring());
    const outside = realpathSync(emptyDir());
    installStandIn(outside, 'jotai');
    importing(outside, ['jotai']);
    const server = await devServer(plugin);
    try {
      const resolved = await server.pluginContainer.resolveId(
        'jotai',
        path.join(outside, 'index.js')
      );
      expect(resolved?.id).toBe(path.join(outside, 'node_modules/jotai/index.js'));
    } finally {
      await server.close();
    }
  });
});

describe("a plugin's build module", () => {
  /**
   * A new plugin directory with id `id`, an index.js entry, a build module (`build.mjs`) with no
   * plugins, and these files (path in it to text) in place of those.
   */
  const withFiles = (id: string, files: Record<string, string>) => {
    const dir = realpathSync(pluginDir(declaring({ id, build: './build.mjs' })));
    writeFiles(dir, { 'build.mjs': 'export default [];\n', ...files });
    return dir;
  };

  /** The code of an index.js whose default export imports ./helper.js. */
  const IMPORTS_HELPER =
    "import * as helper from './helper.js';\nexport default { messageRenderers: [], helper };\n";

  /** The code of an index.js whose default export imports `virtual:greeting`. */
  const IMPORTS_GREETING =
    "import greeting from 'virtual:greeting';\nexport default { messageRenderers: [], greeting };\n";

  it("transforms the plugin's own modules, not an app module or another plugin's with the same text", async () => {
    // `QueryClient` stands for any text: the app module APP_IMPORTS has it.
    const own = withFiles('own', {
      'build.mjs':
        "export default { name: 'rename', transform: { order: 'pre', handler: (code) => code.replaceAll('QueryClient', 'Renamed') } };\n",
      'index.js': "export default { messageRenderers: [], ownText: 'QueryClient' };\n",
    });
    const other = withFiles('other', {
      'index.js': "export default { messageRenderers: [], otherText: 'QueryClient' };\n",
    });
    const code = await buildCode(
      { MINDROOM_CLIENT_PLUGINS: `${own},${other}` },
      { inputs: [APP_IMPORTS], external: packages }
    );
    expect(code).toMatch(/ownText: "Renamed"/);
    expect(code).toMatch(/otherText: "QueryClient"/);
    expect(code).toMatch(/import \{ QueryClient \} from "@tanstack\/react-query"/);
  });

  it("loads only the plugin's own modules", async () => {
    const own = withFiles('own', {
      'build.mjs':
        "export default { name: 'stand-in', load: () => 'export default { messageRenderers: [], loaded: true };' };\n",
    });
    const other = withFiles('other', {
      'index.js': "export default { messageRenderers: [], otherText: 'kept' };\n",
    });
    const code = await buildCode(
      { MINDROOM_CLIENT_PLUGINS: `${own},${other}` },
      { inputs: [APP_IMPORTS], external: packages }
    );
    expect(code).toMatch(/loaded: true/);
    expect(code).toMatch(/otherText: "kept"/);
    expect(code).toMatch(/import \{ QueryClient \} from "@tanstack\/react-query"/);
  });

  it("resolves only the imports in the plugin's own modules", async () => {
    const helper = 'export const helper = true;\n';
    const own = withFiles('own', {
      'build.mjs':
        "import { fileURLToPath } from 'node:url';\n" +
        "const swapped = fileURLToPath(new URL('./swapped.js', import.meta.url));\n" +
        "export default { name: 'swap', enforce: 'pre', resolveId: (source) => source === './helper.js' ? swapped : null };\n",
      'index.js': IMPORTS_HELPER,
      'helper.js': helper,
      'swapped.js': 'export const swapped = true;\n',
    });
    const other = withFiles('other', {
      'index.js': IMPORTS_HELPER,
      'helper.js': helper,
    });
    const outside = realpathSync(emptyDir());
    writeFiles(outside, { 'index.js': "export * from './helper.js';\n", 'helper.js': helper });
    const modules = await bundlePlugin(`${own},${other}`, [path.join(outside, 'index.js')]);
    expect(modules).toContain(path.join(own, 'swapped.js'));
    expect(modules).not.toContain(path.join(own, 'helper.js'));
    expect(modules).toContain(path.join(other, 'helper.js'));
    expect(modules).toContain(path.join(outside, 'helper.js'));
  });

  it('loads and transforms the modules its resolveId makes up under its own id, as Vite virtual modules', async () => {
    const dir = withFiles('own', {
      'build.mjs':
        "export default { name: 'made-up', enforce: 'pre',\n" +
        "  resolveId: (source) => (source === 'virtual:greeting' ? '\\0own:greeting' : null),\n" +
        "  load: (id) => (id === '\\0own:greeting' ? 'export default \"made up\";' : null),\n" +
        "  transform: (code, id) => (id === '\\0own:greeting' ? code.replace('made', 'made and changed') : null) };\n",
      'index.js': IMPORTS_GREETING,
    });
    const code = await buildCode({ MINDROOM_CLIENT_PLUGINS: dir });
    expect(code).toContain('made and changed up');
  });

  it('leaves a module another plugin makes up to that plugin', async () => {
    // Listed first and `pre`, `greedy` would load every made-up module if they were anyone's.
    const greedy = withFiles('greedy', {
      'build.mjs':
        "export default { name: 'greedy', enforce: 'pre', load: (id) => (id.startsWith('\\0') ? 'export default \"taken\";' : null) };\n",
    });
    const own = withFiles('own', {
      'build.mjs':
        "export default { name: 'made-up', enforce: 'pre',\n" +
        "  resolveId: (source) => (source === 'virtual:greeting' ? '\\0own:greeting' : null),\n" +
        "  load: (id) => (id === '\\0own:greeting' ? 'export default \"made up\";' : null) };\n",
      'index.js': IMPORTS_GREETING,
    });
    const code = await buildCode({ MINDROOM_CLIENT_PLUGINS: `${greedy},${own}` });
    expect(code).toContain('made up');
    expect(code).not.toContain('taken');
  });

  it('runs in the dev server for the files it serves', async () => {
    const dir = withFiles('own', {
      'build.mjs':
        "export default { name: 'rename', transform: (code) => code.replace('Plain', 'Renamed') };\n",
      'index.js': "export default { messageRenderers: [], text: 'Plain' };\n",
    });
    const server = await devServer(dir);
    try {
      const served = await server.transformRequest(`/@fs${path.join(dir, 'index.js')}`);
      expect(served?.code).toContain('Renamed');
    } finally {
      await server.close();
    }
  });

  it('fails the build for a hook other than resolveId, load and transform, naming the plugin and the hook', async () => {
    const dir = withFiles('some-plugin', {
      // A hook left undefined, as `load` here, is none.
      'build.mjs':
        "export default [{ name: 'fine', load: undefined }, [{ name: 'notes', generateBundle() {} }]];\n",
    });
    await expect(
      buildEntries({ MINDROOM_CLIENT_PLUGINS: dir }, { external: packages })
    ).rejects.toThrow(
      `MINDROOM_CLIENT_PLUGINS: ${dir}: the Vite plugin "notes" of plugin "some-plugin" has generateBundle`
    );
  });

  it.each([
    ['a function that makes one', "export default () => ({ name: 'made-by-a-call' });\n"],
    ['a promise of one', "export default [Promise.resolve({ name: 'later' })];\n"],
    [
      'an instance of a class, whose hooks are not its own properties',
      "export default new (class { name = 'scope'; transform() { return null; } })();\n",
    ],
  ])('fails the build for a default export of %s, naming the module', async (_case, code) => {
    const dir = withFiles('some-plugin', { 'build.mjs': code });
    await expect(
      buildEntries({ MINDROOM_CLIENT_PLUGINS: dir }, { external: packages })
    ).rejects.toThrow(
      `MINDROOM_CLIENT_PLUGINS: ${dir}: the default export of ${dir}/build.mjs is not a Vite plugin or an array of them`
    );
  });

  it("keeps a Vite plugin with apply: 'build' out of the dev server", async () => {
    const dir = withFiles('some-plugin', {
      'build.mjs':
        "export default { name: 'build-only', apply: 'build', transform: () => null };\n",
    });
    const names = async (command: 'build' | 'serve') =>
      (
        await resolveConfig(
          {
            configFile: false,
            root: ROOT,
            logLevel: 'silent',
            plugins: [clientPlugins({ MINDROOM_CLIENT_PLUGINS: dir })],
          },
          command
        )
      ).plugins.map(({ name }) => name);
    expect(await names('build')).toContain('build-only');
    expect(await names('serve')).not.toContain('build-only');
  });
});

describe('pluginOwner', () => {
  it('names the innermost plugin directory that holds a file, unless the app inside it does', () => {
    const top = realpathSync(emptyDir());
    for (const dir of ['outer/inner', 'outer/app'])
      mkdirSync(path.join(top, dir), { recursive: true });
    const outer = { id: 'outer', dir: path.join(top, 'outer') };
    const inner = { id: 'inner', dir: path.join(top, 'outer/inner') };
    // The app as a submodule of the outer plugin's repository.
    const ownerOf = pluginOwner([outer, inner], `${path.join(top, 'outer/app')}/`);
    const owner = (file: string) => ownerOf(path.join(top, file))?.plugin.id;
    expect(owner('outer/index.js')).toBe('outer');
    expect(owner('outer/inner/node_modules/jotai/index.js')).toBe('inner');
    expect(owner('outer/app/node_modules/jotai/index.js')).toBeUndefined();
    expect(owner('elsewhere/index.js')).toBeUndefined();
    // A plugin inside the app is the plugin's.
    expect(
      pluginOwner([inner], `${path.join(top, 'outer')}/`)(path.join(inner.dir, 'x.js'))?.root
    ).toBe(`${inner.dir}/`);
  });
});
