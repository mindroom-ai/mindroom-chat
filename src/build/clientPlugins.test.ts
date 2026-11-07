import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rollup, type UserConfig } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { clientPlugins, readClientPlugins } from '../../scripts/client-plugins.mjs';
import { onePackageCopyPerVersion } from '../../scripts/package-copies.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLE = path.join(ROOT, 'src/app/plugins/__fixtures__/example-plugin');

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

  it('reads the id, version and entry of each listed directory, in order', () => {
    // The example needs client SDK 2; the other was written for 1, which this client still builds.
    const other = pluginDir(declaring());
    expect(readClientPlugins(` ${EXAMPLE} ,${other},`)).toEqual([
      { id: 'example', version: '1.0.0', dir: EXAMPLE, entry: path.join(EXAMPLE, 'index.tsx') },
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
      () => pluginDir(declaring({ apiVersion: 4 })),
      /plugin "some-plugin" needs client SDK apiVersion 4; this client provides 3/,
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
  /** The code a build makes of src/app/plugins/pluginEntries.ts with these build variables. */
  const bundleEntries = async (env: Record<string, string | undefined>): Promise<string> => {
    const output = (await build({
      configFile: false,
      root: ROOT,
      publicDir: false,
      logLevel: 'silent',
      plugins: [clientPlugins(env)],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: path.join(ROOT, 'src/app/plugins/pluginEntries.ts'),
          preserveEntrySignatures: 'strict',
          // Packages stay out: the entries module and the plugins' own files are what is checked.
          external: (id) => !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0'),
        },
      },
    })) as Rollup.RollupOutput;
    return output.output.map((file) => (file.type === 'chunk' ? file.code : '')).join('\n');
  };

  it('builds each listed plugin into the entries module', async () => {
    const code = await bundleEntries({ MINDROOM_CLIENT_PLUGINS: EXAMPLE });
    expect(code).toContain('com.example.greeting');
    expect(code).toMatch(/id: "example",\s*version: "1\.0\.0"/);
  });

  it('lets the dev server serve the plugin directories besides the workspace', () => {
    const config = (plugins: string | undefined) =>
      (clientPlugins({ MINDROOM_CLIENT_PLUGINS: plugins }).config as () => UserConfig)();
    expect(config(EXAMPLE).server?.fs?.allow).toEqual([path.resolve(ROOT), EXAMPLE]);
    expect(config(undefined).server).toBeUndefined();
  });

  it('resolves the client SDK for a plugin outside this repository', async () => {
    const dir = pluginDir(declaring({ apiVersion: 2 }), { entry: false });
    writeFileSync(
      path.join(dir, 'index.js'),
      "import { usePluginConfig } from '@mindroom/client-sdk/core';\n" +
        'export default { messageRenderers: [], usePluginConfig };\n'
    );
    const output = (await build({
      configFile: false,
      root: ROOT,
      publicDir: false,
      logLevel: 'silent',
      plugins: [clientPlugins({ MINDROOM_CLIENT_PLUGINS: dir })],
      build: {
        write: false,
        rollupOptions: {
          input: path.join(ROOT, 'src/app/plugins/pluginEntries.ts'),
          preserveEntrySignatures: 'strict',
        },
      },
    })) as Rollup.RollupOutput;
    const modules = output.output.flatMap((file) =>
      file.type === 'chunk' ? Object.keys(file.modules) : []
    );
    // The SDK's export is the app's own module, not a copy or a stand-in.
    expect(modules).toContain(path.join(ROOT, 'src/app/plugins/pluginConfig.ts'));
  });

  it('ships no plugin code without plugins', async () => {
    const code = await bundleEntries({});
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
            input: [path.join(ROOT, 'src/app/plugins/pluginEntries.ts'), path.join(appCopy, entry)],
            preserveEntrySignatures: 'strict',
          },
        },
      });
    // Two copies of one linkifyjs version are bundled; the plugin's own counts as the plugin's.
    await expect(bundle([own])).resolves.toBeDefined();
    await expect(bundle([])).rejects.toThrow(`linkifyjs@${version}`);
  });
});
