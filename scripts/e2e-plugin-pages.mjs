// @ts-check
// The fixture pages of the e2e stack's plugin directories ($E2E_PLUGIN_DIRS, scripts/agent-stack/stack.py): each
// directory's e2e/fixtures/ is served at /e2e/plugins/<directory name>/, by the dev server and, through the fixture
// page build of `scripts/e2e-slot.sh --preview` (vite.config.js), by `vite preview`, as e2e/fixtures/ is served at
// /e2e/fixtures/. A page's modules import this repository's packages by name and its sources from /src/.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { searchForWorkspaceRoot } from 'vite';

const PAGES = path.join('e2e', 'fixtures');
const URL_PREFIX = '/e2e/plugins/';

/**
 * The directories $E2E_PLUGIN_DIRS names, separated like PATH; a relative one is relative to `repository`.
 * Each is its real path, as the module IDs Vite resolves in it are.
 * @param {string | undefined} value
 * @param {string} repository
 */
export const pluginDirectories = (value, repository) =>
  (value ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => {
      const directory = path.resolve(repository, entry);
      if (!existsSync(directory) || !statSync(directory).isDirectory()) {
        throw new Error(`E2E_PLUGIN_DIRS names ${directory}, which is not a directory`);
      }
      return realpathSync(directory);
    });

/**
 * The URL of each fixture page of `directories`, by a build input name.
 * @param {string[]} directories
 */
export const pluginPageInputs = (directories) =>
  Object.fromEntries(
    directories.flatMap((directory) => {
      const pages = path.join(directory, PAGES);
      const name = path.basename(directory);
      return existsSync(pages)
        ? readdirSync(pages)
            .filter((file) => file.endsWith('.html'))
            .map((file) => [
              `plugin-${name}/${file.slice(0, -'.html'.length)}`,
              `${URL_PREFIX}${name}/${file}`,
            ])
        : [];
    })
  );

/**
 * Vite plugin: serves and builds the fixture pages of `directories`.
 * @param {string[]} directories
 * @returns {import('vite').Plugin}
 */
export const pluginPages = (directories) => {
  const pagesByName = new Map();
  directories.forEach((directory) => {
    const name = path.basename(directory);
    if (pagesByName.has(name))
      throw new Error(`Two directories of E2E_PLUGIN_DIRS are named ${name}`);
    pagesByName.set(name, path.join(directory, PAGES));
  });
  let root = '';
  /**
   * The URL and file of a page or module under /e2e/plugins/, given by its URL or its path under the root.
   * @param {string} id
   */
  const pageOf = (id) => {
    const url = id.startsWith(`${root}/`) ? id.slice(root.length) : id;
    if (!url.startsWith(URL_PREFIX)) return undefined;
    const [name = '', ...rest] = url.slice(URL_PREFIX.length).split('/');
    const pages = pagesByName.get(name);
    const file = pages === undefined ? undefined : path.join(pages, ...rest);
    return file?.startsWith(pages + path.sep) && existsSync(file) ? { url, file } : undefined;
  };
  return {
    name: 'mindroom-e2e-plugin-pages',
    enforce: 'pre',
    config: () => ({
      server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...directories] } },
    }),
    configResolved(config) {
      root = config.root;
    },
    resolveId(source, importer, options) {
      const page = pageOf(
        importer && source.startsWith('.') ? path.join(path.dirname(importer), source) : source
      );
      // A page keeps a path under the root as its ID, so the build writes it to its URL; its modules are their files.
      if (page) return page.file.endsWith('.html') ? `${root}${page.url}` : page.file;
      // A module in a plugin directory imports packages as this repository's own modules do.
      if (
        importer &&
        /^[\w@]/.test(source) &&
        !source.includes(':') &&
        directories.some((directory) => importer.startsWith(directory + path.sep))
      ) {
        return this.resolve(source, path.join(root, 'index.html'), { ...options, skipSelf: true });
      }
      return null;
    },
    load(id) {
      const page = id.endsWith('.html') ? pageOf(id) : undefined;
      return page ? readFileSync(page.file, 'utf8') : null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [url = '', ...query] = (req.url ?? '').split('?');
        const page = pageOf(url);
        if (!page || !page.file.endsWith('.html')) {
          // A page's other files, modules and assets alike, are served from where they are.
          if (page) req.url = ['/@fs' + page.file, ...query].join('?');
          next();
          return;
        }
        server
          .transformIndexHtml(url, readFileSync(page.file, 'utf8'), req.originalUrl)
          .then((html) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          }, next);
      });
    },
  };
};
