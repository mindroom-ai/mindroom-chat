// @ts-check
// Client plugins (docs/architecture.md "Client plugins"): MINDROOM_CLIENT_PLUGINS lists their
// directories, absolute and comma-separated. Each has its own installed node_modules and a
// package.json that declares `"mindroomClientPlugin": { "id", "apiVersion", "entry" }`; the build
// fails on a directory it cannot use. The build replaces src/app/plugins/pluginEntries.ts with a
// module that imports each plugin's entry; without plugins that module lists none and no plugin code
// ships.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, searchForWorkspaceRoot } from 'vite';

/** The plugin API this client implements; each plugin declares the one it was written for. */
const CLIENT_PLUGIN_API_VERSION = 1;

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENTRIES_MODULE = normalizePath(
  fileURLToPath(new URL('../src/app/plugins/pluginEntries.ts', import.meta.url))
);

/**
 * The packages the app shares with every plugin: imports of them from a plugin's files resolve to the
 * app's copy, so that the state each keeps is one (React's hooks, the Matrix SDK's classes and module
 * state, jotai's stores, TanStack Query's client, React Router's router, the translations, folds'
 * theme, focus-trap's stack of traps, dayjs's locale). A plugin that would import its own copy of one
 * fails the build.
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
  if (apiVersion !== CLIENT_PLUGIN_API_VERSION) {
    fail(
      `apiVersion ${JSON.stringify(
        apiVersion
      )} is not ${CLIENT_PLUGIN_API_VERSION}, the plugin API this client supports`
    );
  }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    fail('package.json has no "version"');
  }
  const entryPath = typeof entry === 'string' && entry !== '' ? path.resolve(dir, entry) : '';
  if (!entryPath || !existsSync(entryPath)) fail(`entry ${JSON.stringify(entry)} does not exist`);
  const other = earlier.find((plugin) => plugin.id === id);
  if (other) fail(`id "${id}" is also the id of ${other.dir}`);
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

/**
 * The copy of package `name` that Node would find first from `file`, when it is inside the plugin
 * directory `root`: the plugin's own.
 * @param {string} file
 * @param {string} name
 * @param {string} root
 */
const ownCopy = (file, name, root) => {
  for (let dir = path.dirname(file); `${dir}/`.startsWith(root); dir = path.dirname(dir)) {
    const copy = path.join(dir, 'node_modules', name);
    if (existsSync(copy)) return copy;
  }
  return undefined;
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
  // Module ids are real paths.
  const roots = plugins.map((plugin) => ({ plugin, root: `${realpathSync(plugin.dir)}/` }));
  return {
    name: 'mindroom-client-plugins',
    enforce: 'pre',
    config: () =>
      plugins.length > 0
        ? {
            // Resolved from the app's root, wherever the importer is.
            resolve: { dedupe: SHARED_PACKAGES },
            // The dev server serves files outside the workspace only from directories it allows,
            // and a list of them replaces its default, the workspace root.
            server: {
              fs: {
                allow: [searchForWorkspaceRoot(process.cwd()), ...plugins.map(({ dir }) => dir)],
              },
            },
          }
        : undefined,
    // A plugin's file that imports a shared package fails the build when it would find its own copy.
    resolveId(source, importer) {
      const name = source.split('/', source.startsWith('@') ? 2 : 1).join('/');
      if (!importer || !SHARED_PACKAGES.includes(name)) return null;
      for (const { plugin, root } of roots) {
        const copy = importer.startsWith(root) ? ownCopy(importer, name, root) : undefined;
        if (!copy) continue;
        this.error(
          [
            `MINDROOM_CLIENT_PLUGINS: ${plugin.dir} (plugin "${plugin.id}"):`,
            `${path.relative(root, importer)} imports ${name} from the plugin's own copy`,
            `(${path.relative(root, copy)}).`,
            `The app shares ${name} with every plugin: list it under`,
            'peerDependencies rather than dependencies, and install the plugin with',
            "npm ci --omit=dev --omit=peer, so that it resolves to the app's copy.",
          ].join(' ')
        );
      }
      return null;
    },
    load: (id) =>
      plugins.length > 0 && normalizePath(id.split('?')[0] ?? id) === ENTRIES_MODULE
        ? entriesModule(plugins)
        : undefined,
  };
};
