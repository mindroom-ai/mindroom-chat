import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';
import { CLIENT_SDK_ALIAS, SHARED_PACKAGES, readClientPlugins } from './scripts/client-plugins.mjs';

// Unit tests run without the vanilla-extract plugin: tests mock `*.css.ts` modules
// (see src/test/vitest.setup.ts) or load them under one file scope (src/test/vitest.styles.setup.ts), so
// this config stays separate from vite.config.js.
// The default environment is node: the DOM tests opt in with `// @vitest-environment jsdom`,
// and tests that read files through `new URL(..., import.meta.url)` break under jsdom's URL.

// The tests of the client plugins MINDROOM_CLIENT_PLUGINS lists run with the app's, with its setup
// files and, as in the build, automatic JSX and the app's copies of the packages it shares with
// plugins. `src/**` already holds the tests of a plugin inside src/, such as the example plugin.
// Real paths, as module ids are.
const SRC = realpathSync(fileURLToPath(new URL('src', import.meta.url)));
const pluginDirs = readClientPlugins(process.env.MINDROOM_CLIENT_PLUGINS)
  .map(({ dir }) => normalizePath(realpathSync(dir)))
  .filter((dir) => path.relative(SRC, dir).startsWith('..'));
// Without such plugins, the app's own tests resolve and compile as they always did.
const withPlugins = pluginDirs.length > 0;

export default defineConfig({
  resolve: {
    // Plugins import the app through the client SDK; their tests also through its `/testing`
    // subpath, which the build leaves out so that code that ships cannot import it.
    alias: {
      ...CLIENT_SDK_ALIAS,
      '@mindroom/client-sdk/testing': fileURLToPath(
        new URL('src/client-sdk/testing.ts', import.meta.url)
      ),
    },
    dedupe: withPlugins ? SHARED_PACKAGES : undefined,
  },
  esbuild: withPlugins ? { jsx: 'automatic' } : undefined,
  server: withPlugins
    ? { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...pluginDirs] } }
    : undefined,
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      // A directory such as `plugins (old)` holds characters globs read as syntax.
      ...pluginDirs.map((dir) => `${dir.replace(/[()*?[\]{|}]/g, '\\$&')}/**/*.test.{ts,tsx}`),
    ],
    // Vite, not Node, loads the packages a plugin installed, so that their imports of the shared
    // packages resolve to the app's copies too; a CommonJS `require` still resolves in its directory.
    server: {
      deps: {
        inline: pluginDirs.map(
          (dir) => new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/node_modules/`)
        ),
      },
    },
    setupFiles: [
      './src/test/vitest.styles.setup.ts',
      './src/test/vitest.setup.ts',
      './src/test/vitest.katex.setup.ts',
    ],
    // Setting process.env.TZ moves the time zone only in a process of its own: a worker thread
    // keeps the zone it started in, so this file stays in a fork under `--pool=threads` too.
    poolMatchGlobs: [['**/src/app/lib/time.formatterCache.test.ts', 'forks']],
  },
});
