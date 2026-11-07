// @ts-check
// Client plugins (docs/architecture.md "Client plugins"): MINDROOM_CLIENT_PLUGINS lists their
// directories, absolute and comma-separated. Each has its own installed node_modules and a
// package.json that declares `"mindroomClientPlugin": { "id", "apiVersion", "entry" }`; the build
// fails on a directory it cannot use. The build replaces src/app/plugins/pluginEntries.ts with a
// module that imports each plugin's entry; without plugins that module lists none and no plugin code
// ships. Plugins import the app through the client SDK (`@mindroom/client-sdk/<subpath>`), which
// the build resolves to src/client-sdk/.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, searchForWorkspaceRoot } from 'vite';

/**
 * The client SDK version this client provides (`src/client-sdk/`); each plugin declares, as its
 * `apiVersion`, the one it needs. Version 1 had no SDK; each later addition to the SDK (an export,
 * or a contribution kind in `ClientPlugin`) raises it.
 */
const CLIENT_PLUGIN_API_VERSION = 5;

/** The SDK's subpaths, which plugins import, and the modules they are. */
export const CLIENT_SDK_ALIAS = {
  '@mindroom/client-sdk/core': fileURLToPath(new URL('../src/client-sdk/core.ts', import.meta.url)),
};

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENTRIES_MODULE = normalizePath(
  fileURLToPath(new URL('../src/app/plugins/pluginEntries.ts', import.meta.url))
);

/**
 * The packages the app shares with every plugin: a plugin's imports of them, and those of the
 * packages it installed, resolve as the app's own imports do, so that the state each keeps is one
 * (React's hooks, the Matrix SDK's classes and module state, jotai's stores, TanStack Query's
 * client, React Router's router, the translations, folds' theme, focus-trap's stack of traps, dayjs's
 * locale). A plugin that lists one under `dependencies` fails the build.
 */
export const SHARED_PACKAGES = [
  'react',
  'react-dom',
  'scheduler',
  'matrix-js-sdk',
  'jotai',
  '@tanstack/react-query',
  '@tanstack/query-core',
  'react-router',
  'react-router-dom',
  '@remix-run/router',
  'i18next',
  'react-i18next',
  'folds',
  'focus-trap',
  'focus-trap-react',
  'dayjs',
];

/** @typedef {{ id: string, version: string, dir: string, entry: string }} ClientPluginInfo */

/**
 * The plugin in `dir`, or an error that names the directory and what is wrong with it; `earlier`
 * are the plugins listed before it.
 * @param {string} dir
 * @param {ClientPluginInfo[]} earlier
 * @returns {ClientPluginInfo}
 */
const readPlugin = (dir, earlier) => {
  /** @returns {never} */
  const fail = (/** @type {string} */ reason) => {
    throw new Error(`MINDROOM_CLIENT_PLUGINS: ${dir}: ${reason}`);
  };
  if (!path.isAbsolute(dir)) fail('not an absolute directory');
  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch (error) {
    fail(`cannot read package.json (${error instanceof Error ? error.message : String(error)})`);
  }
  const declaration = manifest?.mindroomClientPlugin;
  if (typeof declaration !== 'object' || declaration === null) {
    fail('package.json declares no "mindroomClientPlugin" object');
  }
  const { id, apiVersion, entry } = declaration;
  if (typeof id !== 'string' || !KEBAB_CASE.test(id)) {
    fail(`id ${JSON.stringify(id)} is not kebab-case, such as "my-plugin"`);
  }
  if (!Number.isInteger(apiVersion) || apiVersion < 1) {
    fail(`apiVersion ${JSON.stringify(apiVersion)} is not a positive whole number`);
  }
  if (apiVersion > CLIENT_PLUGIN_API_VERSION) {
    fail(
      `plugin "${id}" needs client SDK apiVersion ${apiVersion}; this client provides ${CLIENT_PLUGIN_API_VERSION}`
    );
  }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    fail('package.json has no "version"');
  }
  const entryPath = typeof entry === 'string' && entry !== '' ? path.resolve(dir, entry) : '';
  if (!entryPath || !existsSync(entryPath)) fail(`entry ${JSON.stringify(entry)} does not exist`);
  const other = earlier.find((plugin) => plugin.id === id);
  if (other) fail(`id "${id}" is also the id of ${other.dir}`);
  const shared = SHARED_PACKAGES.find((name) => Object.hasOwn(manifest.dependencies ?? {}, name));
  if (shared) {
    fail(
      `plugin "${id}" lists ${shared} under dependencies, but every plugin gets the app's ${shared}: list it under peerDependencies instead`
    );
  }
  return { id, version: manifest.version, dir, entry: normalizePath(entryPath) };
};

/**
 * The plugins MINDROOM_CLIENT_PLUGINS (`list`) names, in its order.
 * @param {string | undefined} list
 * @returns {ClientPluginInfo[]}
 */
export const readClientPlugins = (list) => {
  /** @type {ClientPluginInfo[]} */
  const plugins = [];
  for (const dir of (list ?? '').split(',').map((item) => item.trim())) {
    if (dir !== '') plugins.push(readPlugin(dir, plugins));
  }
  return plugins;
};

// The app's own directory, which a plugin directory may hold (the app as a submodule of the plugin's
// repository).
const APP_ROOT = `${realpathSync(fileURLToPath(new URL('..', import.meta.url)))}/`;

/**
 * Which of `plugins` a file belongs to: the innermost plugin directory that holds it, unless the app's
 * own directory inside that plugin directory holds it. Paths are real paths, as module ids and source
 * maps name them.
 * @template {{ dir: string }} P
 * @param {P[]} plugins
 * @param {string} [appRoot]
 * @returns {(file: string) => { plugin: P, root: string } | undefined}
 */
export const pluginOwner = (plugins, appRoot = APP_ROOT) => {
  const roots = plugins
    .map((plugin) => ({ plugin, root: `${realpathSync(plugin.dir)}/` }))
    .sort((a, b) => b.root.length - a.root.length);
  return (file) => {
    const owner = roots.find(({ root }) => file.startsWith(root));
    const inApp = owner && appRoot.startsWith(owner.root) && file.startsWith(appRoot);
    return inApp ? undefined : owner;
  };
};

/**
 * What src/app/plugins/pluginEntries.ts becomes: an import of each plugin's entry, in order.
 * @param {ClientPluginInfo[]} plugins
 */
const entriesModule = (plugins) => {
  const imports = plugins.map(({ entry }, i) => `import plugin${i} from ${JSON.stringify(entry)};`);
  const entries = plugins.map(
    ({ id, version }, i) =>
      `{ id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)}, plugin: plugin${i} }`
  );
  return `${imports.join('\n')}\nexport const pluginEntries = [${entries.join(', ')}];\n`;
};

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {import('vite').Plugin}
 */
export const clientPlugins = (env = process.env) => {
  const plugins = readClientPlugins(env.MINDROOM_CLIENT_PLUGINS);
  const ownerOf = pluginOwner(plugins);
  // The dev server pre-bundles a plugin's installed packages without plugin hooks, so only builds
  // redirect: a plugin and its packages then always resolve the same copy.
  let building = false;
  return {
    name: 'mindroom-client-plugins',
    enforce: 'pre',
    config: () => ({
      resolve: { alias: CLIENT_SDK_ALIAS },
      // The dev server serves files outside the workspace only from directories it allows, and a
      // list of them replaces its default, the workspace root.
      server:
        plugins.length > 0
          ? {
              fs: {
                allow: [searchForWorkspaceRoot(process.cwd()), ...plugins.map(({ dir }) => dir)],
              },
            }
          : undefined,
    }),
    configResolved: ({ command }) => {
      building = command === 'build';
    },
    // In a build, a plugin's imports of the packages the app shares resolve as the app's own do.
    async resolveId(source, importer, options) {
      if (!building || !importer) return null;
      const name = source.split('/', source.startsWith('@') ? 2 : 1).join('/');
      if (!SHARED_PACKAGES.includes(name)) return null;
      const owner = ownerOf(importer);
      if (!owner) return null;
      const resolved = await this.resolve(source, ENTRIES_MODULE, { ...options, skipSelf: true });
      if (!resolved) {
        const file = path.relative(owner.root, importer);
        this.error(
          `MINDROOM_CLIENT_PLUGINS: ${owner.plugin.dir}: ${file} imports ${source}, which the app's ${name} does not have`
        );
      }
      return resolved;
    },
    load: (id) =>
      plugins.length > 0 && normalizePath(id.split('?')[0] ?? id) === ENTRIES_MODULE
        ? entriesModule(plugins)
        : undefined,
  };
};
