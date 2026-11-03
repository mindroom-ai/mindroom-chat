import { defineConfig } from 'vitest/config';

// Unit tests run without the vanilla-extract plugin: tests mock `*.css.ts` modules
// (see src/vitest.setup.ts), so this config stays separate from vite.config.js.
// The default environment is node: the DOM tests opt in with `// @vitest-environment jsdom`,
// and tests that read files through `new URL(..., import.meta.url)` break under jsdom's URL.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/vitest.setup.ts'],
  },
});
