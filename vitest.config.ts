import { defineConfig } from 'vitest/config';
import { CLIENT_SDK_ALIAS } from './scripts/client-plugins.mjs';

// Unit tests run without the vanilla-extract plugin: tests mock `*.css.ts` modules
// (see src/test/vitest.setup.ts) or load them under one file scope (src/test/vitest.styles.setup.ts), so
// this config stays separate from vite.config.js.
// The default environment is node: the DOM tests opt in with `// @vitest-environment jsdom`,
// and tests that read files through `new URL(..., import.meta.url)` break under jsdom's URL.
export default defineConfig({
  // The example client plugin imports the app through the client SDK, as plugins do.
  resolve: { alias: CLIENT_SDK_ALIAS },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
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
