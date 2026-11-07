// @ts-check
// The plugin directories of the e2e stack ($E2E_PLUGIN_DIRS, scripts/agent-stack/stack.py) are served at
// /e2e-plugins/<directory name>/, laid out as each directory is, so a fixture page in its e2e/fixtures/ is at
// /e2e-plugins/<directory name>/e2e/fixtures/<page>.html. The dev server serves each directory from where it is
// (`pluginDirectoryServer`); `scripts/e2e-slot.sh --preview` copies them to e2e-plugins/ in its snapshot, where
// the fixture page build finds their pages (`pluginPageInputs`). A page's modules import this repository's
// packages by name and its sources from /src/.
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
 * The fixture pages of the plugin directories copied to `copies` (e2e-plugins/ of a snapshot), by a build
 * input name.
 * @param {string} copies
 */
export const pluginPageInputs = (copies) =>
  Object.fromEntries(
    (existsSync(copies) ? readdirSync(copies) : []).flatMap((name) => {
      const pages = path.join(copies, name, 'e2e', 'fixtures');
      return existsSync(pages)
        ? readdirSync(pages)
            .filter((file) => file.endsWith('.html'))
            .map((file) => [
              `plugin-${name}/${file.slice(0, -'.html'.length)}`,
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
    const file = directory === undefined ? undefined : path.join(directory, ...rest);
    return file?.startsWith(directory + path.sep) && existsSync(file) ? file : undefined;
  };
  return {
    name: 'mindroom-e2e-plugin-directories',
    enforce: 'pre',
    config: () => ({
      server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...directories] } },
    }),
    resolveId(source, importer, options) {
      // A page's own URLs, which Vite also asks for ahead of the browser.
      const [request = '', ...query] = source.split('?');
      const file = fileOf(request);
      if (file) return [file, ...query].join('?');
      // A module in a plugin directory imports packages as this repository's own modules do.
      if (
        importer &&
        /^[\w@]/.test(source) &&
        !source.includes(':') &&
        directories.some((directory) => importer.startsWith(directory + path.sep))
      ) {
        return this.resolve(source, path.join(process.cwd(), 'index.html'), {
          ...options,
          skipSelf: true,
        });
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [url = '', ...query] = (req.url ?? '').split('?');
        let file;
        try {
          file = fileOf(decodeURI(url));
        } catch {
          // A malformed escape names no file.
        }
        if (file === undefined) {
          next();
          return;
        }
        if (!file.endsWith('.html')) {
          req.url = [`/@fs${encodeURI(file)}`, ...query].join('?');
          next();
          return;
        }
        // Vite answers a page outside the root with the app, so the page is transformed here, at its URL.
        server.transformIndexHtml(url, readFileSync(file, 'utf8'), req.originalUrl).then((html) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        }, next);
      });
    },
  };
};
