// @ts-check
// The plugin directories of the e2e stack ($E2E_PLUGIN_DIRS, scripts/agent-stack/stack.py) are served at
// /e2e-plugins/<directory name>/, laid out as each directory is, so a fixture page in its e2e/fixtures/ is at
// /e2e-plugins/<directory name>/e2e/fixtures/<page>.html. The dev server serves each directory from where it is
// (`pluginDirectoryServer`); `scripts/e2e-slot.sh --preview` copies them to e2e-plugins/ in its snapshot, where
// the fixture page build finds their pages (`pluginPageInputs`). A page's modules import packages from their
// directory's node_modules, else from this repository's, and this repository's sources from /src/.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { searchForWorkspaceRoot } from 'vite';

const URL_PREFIX = '/e2e-plugins/';

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
 * The copies of the plugin directories in e2e-plugins/ of `repository` (a snapshot).
 * @param {string} repository
 */
export const pluginCopies = (repository) => {
  const copies = path.join(repository, URL_PREFIX);
  return existsSync(copies) ? readdirSync(copies).map((name) => path.join(copies, name)) : [];
};

/**
 * The fixture pages of the plugin directories' copies in `repository`, by a build input name.
 * @param {string} repository
 */
export const pluginPageInputs = (repository) =>
  Object.fromEntries(
    pluginCopies(repository).flatMap((copy) => {
      const pages = path.join(copy, 'e2e', 'fixtures');
      return existsSync(pages)
        ? readdirSync(pages)
            .filter((file) => file.endsWith('.html'))
            .map((file) => [
              `plugin-${path.basename(copy)}/${file.slice(0, -'.html'.length)}`,
              path.join(pages, file),
            ])
        : [];
    })
  );

/**
 * Vite plugin: the dev server serves `directories` at /e2e-plugins/<directory name>/.
 * @param {string[]} directories
 * @returns {import('vite').Plugin}
 */
export const pluginDirectoryServer = (directories) => {
  const directoriesByName = new Map();
  directories.forEach((directory) => {
    const name = path.basename(directory);
    if (directoriesByName.has(name))
      throw new Error(`Two directories of E2E_PLUGIN_DIRS are named ${name}`);
    directoriesByName.set(name, directory);
  });
  /**
   * The file of a plugin directory that a decoded URL path names, if there is one.
   * @param {string} url
   */
  const fileOf = (url) => {
    if (!url.startsWith(URL_PREFIX)) return undefined;
    const [name = '', ...rest] = url.slice(URL_PREFIX.length).split('/');
    const directory = directoriesByName.get(name);
    if (directory === undefined) return undefined;
    const file = path.join(directory, ...rest);
    return file.startsWith(directory + path.sep) && existsSync(file) ? file : undefined;
  };
  return {
    name: 'mindroom-e2e-plugin-directories',
    enforce: 'pre',
    config: () => ({
      server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...directories] } },
    }),
    async resolveId(source, importer, options) {
      // A page's own URLs, which Vite also asks for ahead of the browser.
      const [request = '', ...query] = source.split('?');
      const file = fileOf(request);
      if (file) return [file, ...query].join('?');
      // A module in a plugin directory imports a package as Vite resolves it from the directory (its own
      // node_modules, or a package Vite pre-bundled for the app), else from this repository's node_modules.
      if (
        importer &&
        /^[\w@]/.test(source) &&
        !source.includes(':') &&
        directories.some((directory) => importer.startsWith(directory + path.sep))
      ) {
        const own = await this.resolve(source, importer, { ...options, skipSelf: true });
        return (
          own ??
          this.resolve(source, path.join(process.cwd(), 'index.html'), {
            ...options,
            skipSelf: true,
          })
        );
      }
      return null;
    },
    configureServer(server) {
      /**
       * The path, query and plugin directory file of a request URL.
       * @param {string} [requestUrl]
       */
      const requestOf = (requestUrl = '') => {
        const [url = '', ...query] = requestUrl.split('?');
        let file;
        try {
          file = fileOf(decodeURI(url));
        } catch {
          // A malformed escape names no file.
        }
        return { url, query, file };
      };
      // A directory's other files, modules and assets alike, are served from where they are.
      server.middlewares.use((req, _res, next) => {
        const { query, file } = requestOf(req.url);
        if (file !== undefined && !file.endsWith('.html')) {
          req.url = [`/@fs${encodeURI(file)}`, ...query].join('?');
        }
        next();
      });
      // Its pages are transformed here, at their URL, after Vite has checked the request and before it would
      // answer a page outside the root with the app.
      return () => {
        server.middlewares.use((req, res, next) => {
          const { url, file } = requestOf(req.originalUrl);
          if (!file?.endsWith('.html')) {
            next();
            return;
          }
          server
            .transformIndexHtml(url, readFileSync(file, 'utf8'), req.originalUrl)
            .then((html) => {
              res.setHeader('Content-Type', 'text/html');
              res.end(html);
            }, next);
        });
      };
    },
  };
};
