// @ts-check
// Client plugins (docs/architecture.md "Client plugins"): MINDROOM_CLIENT_PLUGINS lists their
// directories, absolute and comma-separated. Each has its own installed node_modules and a
// package.json that declares `"mindroomClientPlugin": { "id", "apiVersion", "entry" }`; the build
// fails on a directory it cannot use. The build replaces src/app/plugins/pluginEntries.ts with a
// module that imports each plugin's entry; without plugins that module lists none and no plugin code
// ships. Plugins import the app through the client SDK (`@mindroom/client-sdk/<subpath>`), which
// the build resolves to src/client-sdk/. A plugin's public/ directory, if it has one, ships as it
// is under public/plugins/<id>/. A declaration's optional `"build"` names a module of Vite plugins
// for the plugin's own modules.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentType } from 'mime-types';
import { normalizePath, searchForWorkspaceRoot } from 'vite';

/**
 * The client SDK version this client provides (`src/client-sdk/`); each plugin declares, as its
 * `apiVersion`, the one it needs. Version 1 had no SDK; each later addition to the SDK (an export,
 * a contribution kind in `ClientPlugin`, or a field of the declaration) raises it.
 */
export const CLIENT_PLUGIN_API_VERSION = 45;

/** The SDK's subpaths a build resolves, which plugins import, and the modules they are. */
export const CLIENT_SDK_ALIAS = {
  '@mindroom/client-sdk/core': fileURLToPath(new URL('../src/client-sdk/core.ts', import.meta.url)),
  '@mindroom/client-sdk/matrix': fileURLToPath(
    new URL('../src/client-sdk/matrix.ts', import.meta.url)
  ),
  '@mindroom/client-sdk/room': fileURLToPath(new URL('../src/client-sdk/room.ts', import.meta.url)),
  '@mindroom/client-sdk/server': fileURLToPath(
    new URL('../src/client-sdk/server.ts', import.meta.url)
  ),
  '@mindroom/client-sdk/ui': fileURLToPath(new URL('../src/client-sdk/ui.ts', import.meta.url)),
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
 * locale, react-aria's scroll lock, overlay stack and focus scopes). A plugin that lists one under
 * `dependencies` fails the build.
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
  'react-aria',
];

/** The package the app shares that `source` imports, such as `react-aria` for `react-aria/x`. */
const sharedPackage = (/** @type {string} */ source) => {
  const name = source.split('/', source.startsWith('@') ? 2 : 1).join('/');
  return SHARED_PACKAGES.includes(name) ? name : undefined;
};

/** @typedef {{ id: string, version: string, dir: string, entry: string, build?: string }} ClientPluginInfo */

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
  const { id, apiVersion, entry, build } = declaration;
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
  const buildPath = typeof build === 'string' && build !== '' ? path.resolve(dir, build) : '';
  if (buildPath && path.relative(dir, buildPath).split(path.sep)[0] === '..') {
    fail(`build ${JSON.stringify(build)} is outside the plugin's directory`);
  }
  if (build !== undefined && !existsSync(buildPath)) {
    fail(`build ${JSON.stringify(build)} does not exist`);
  }
  const other = earlier.find((plugin) => plugin.id === id);
  if (other) fail(`id "${id}" is also the id of ${other.dir}`);
  const shared = SHARED_PACKAGES.find((name) => Object.hasOwn(manifest.dependencies ?? {}, name));
  if (shared) {
    fail(
      `plugin "${id}" lists ${shared} under dependencies, but every plugin gets the app's ${shared}: list it under peerDependencies instead`
    );
  }
  return {
    id,
    version: manifest.version,
    dir,
    entry: normalizePath(entryPath),
    build: buildPath ? normalizePath(buildPath) : undefined,
  };
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

/** Where the build puts each plugin's public/ directory: public/plugins/<id>/ of the app. */
const PUBLIC_FILES = 'public/plugins';

/**
 * The files in the public/ directory of the plugin in `dir`, as paths in that directory with `/`
 * between their parts; none without one. A symbolic link there, which could lead out of the
 * plugin's directory, or anything else that is neither a file nor a directory, fails the build.
 * @param {string} dir
 * @returns {string[]}
 */
const pluginPublicFiles = (dir) => {
  const root = path.join(dir, 'public');
  /** @returns {never} */
  const fail = (/** @type {string} */ name, /** @type {string} */ what) => {
    throw new Error(
      `MINDROOM_CLIENT_PLUGINS: ${dir}: ${name} is ${what}: a plugin ships only the files inside its public/ directory`
    );
  };
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push(name);
      else
        fail(`public/${name}`, 'neither a file nor a directory (symbolic links are not followed)');
    }
  };
  const stats = lstatSync(root, { throwIfNoEntry: false });
  if (stats?.isDirectory()) walk('');
  else if (stats) fail('public', 'not a directory (symbolic links are not followed)');
  return files;
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

/** The hooks a plugin's build module may have, each with the argument that names its module. */
const BUILD_HOOKS = new Map([
  ['resolveId', 1],
  ['load', 0],
  ['transform', 1],
]);

/**
 * The Vite plugins of the build modules (`build`) of `plugins`, in their order, with each hook kept
 * to its plugin's modules, the ones its `resolveId` makes up under its id included (Vite's virtual
 * modules, such as `\0my-plugin:settings`): `transform` and `load` run only for them, and `resolveId`
 * only for their imports, so that a plugin's hooks see none of the app's modules or another plugin's.
 * Any other hook or property fails the build.
 * @param {ClientPluginInfo[]} plugins
 * @param {ReturnType<typeof pluginOwner<ClientPluginInfo>>} ownerOf
 * @returns {Promise<import('vite').Plugin[]>}
 */
const buildModulePlugins = async (plugins, ownerOf) => {
  const builds = await Promise.all(
    plugins.map(async (plugin) => {
      if (!plugin.build) return [];
      /** @returns {never} */
      const fail = (/** @type {string} */ reason) => {
        throw new Error(`MINDROOM_CLIENT_PLUGINS: ${plugin.dir}: ${reason}`);
      };
      const madeUpPrefix = `\0${plugin.id}:`;
      const { default: exported } = await import(pathToFileURL(plugin.build).href);
      return [exported].flat(Infinity).map((/** @type {any} */ vitePlugin) => {
        // An object literal: a class's hooks are no properties of its instance, so they would be lost.
        if (vitePlugin?.constructor !== Object || typeof vitePlugin.name !== 'string') {
          fail(`the default export of ${plugin.build} is not a Vite plugin or an array of them`);
        }
        /** @type {any} */
        const scoped = {};
        for (const [key, hook] of Object.entries(vitePlugin)) {
          // A hook left undefined is none, as Vite reads it.
          if (key === 'name' || key === 'enforce' || key === 'apply' || hook == null) {
            scoped[key] = hook;
            continue;
          }
          const at = BUILD_HOOKS.get(key);
          if (at === undefined) {
            fail(
              `the Vite plugin "${vitePlugin.name}" of plugin "${plugin.id}" has ${key}, but a plugin's build module may only have name, enforce, apply, resolveId, load and transform`
            );
          }
          const handler = typeof hook === 'function' ? hook : hook.handler;
          /** @this {unknown} */
          const own = function (/** @type {unknown[]} */ ...args) {
            const file = args[at];
            return typeof file === 'string' &&
              (ownerOf(file)?.plugin === plugin || file.startsWith(madeUpPrefix))
              ? handler.apply(this, args)
              : null;
          };
          scoped[key] = typeof hook === 'function' ? own : { ...hook, handler: own };
        }
        return scoped;
      });
    })
  );
  return builds.flat();
};

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {import('vite').PluginOption[]}
 */
export const clientPlugins = (env = process.env) => {
  const plugins = readClientPlugins(env.MINDROOM_CLIENT_PLUGINS);
  const ownerOf = pluginOwner(plugins);
  /** @type {import('vite').Plugin} */
  const app = {
    name: 'mindroom-client-plugins',
    enforce: 'pre',
    config: () => ({
      resolve: { alias: CLIENT_SDK_ALIAS },
      // The dev server pre-bundles the packages a plugin installed with esbuild, without plugin
      // hooks: there their imports and requires of the packages the app shares resolve as the app
      // imports them, to the module the app's own pre-bundle has.
      optimizeDeps: {
        esbuildOptions: {
          plugins: [
            {
              name: 'mindroom-client-plugins',
              setup: (build) => {
                build.onResolve({ filter: /^[\w@]/ }, ({ path: source, importer }) =>
                  sharedPackage(source) && ownerOf(importer)
                    ? build.resolve(source, {
                        kind: 'import-statement',
                        importer: ENTRIES_MODULE,
                        resolveDir: path.dirname(ENTRIES_MODULE),
                      })
                    : undefined
                );
              },
            },
          ],
        },
      },
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
    // A plugin's imports of the packages the app shares resolve as the app's own do.
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const name = sharedPackage(source);
      if (!name) return null;
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
    // Each plugin's public/ directory under public/plugins/<id>/, where every server answers as for
    // the app's other files under public/.
    generateBundle() {
      for (const { id, dir } of plugins) {
        for (const name of pluginPublicFiles(dir)) {
          this.emitFile({
            type: 'asset',
            fileName: `${PUBLIC_FILES}/${id}/${name}`,
            source: readFileSync(path.join(dir, 'public', name)),
          });
        }
      }
    },
    // The dev server serves the same files at the same paths, as they are (Vite's own file serving
    // would run scripts and style sheets through its transforms), and anything else under
    // public/plugins/ as a 404.
    configureServer: (server) => {
      const prefix = `/${PUBLIC_FILES}/`;
      server.middlewares.use((req, res, next) => {
        const [pathname = ''] = (req.url ?? '').split('?');
        if (!pathname.startsWith(prefix)) {
          next();
          return;
        }
        const [id, ...parts] = pathname.slice(prefix.length).split('/');
        const plugin = plugins.find((other) => other.id === id);
        let name = '';
        try {
          name = decodeURIComponent(parts.join('/'));
        } catch {
          // A malformed escape names no file.
        }
        if (plugin && pluginPublicFiles(plugin.dir).includes(name)) {
          const type = contentType(path.extname(name)) || 'application/octet-stream';
          res.setHeader('Content-Type', type);
          res.end(readFileSync(path.join(plugin.dir, 'public', name)));
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
  // The plugins of their build modules come first, so that the resolveId of one that is `pre` too sees
  // its plugin's imports of the packages the app shares before `app` resolves them.
  return [buildModulePlugins(plugins, ownerOf), app];
};
