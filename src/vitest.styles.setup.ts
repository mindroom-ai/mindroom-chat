import { vi } from 'vitest';

// Unit tests run without the vanilla-extract plugin, which gives each `*.css.ts` module a file
// scope to register its classes under. One scope for every test lets a style module load as it
// is wherever a test does not mock it, so a component can use another component's class.
// The scope is set inside a mock of the scope module: `vi.resetModules()` keeps mocks, so a test
// that resets modules still loads styles under it instead of into a fresh copy with no scope.
vi.mock('@vanilla-extract/css/fileScope', async (importOriginal) => {
  const fileScope = await importOriginal<typeof import('@vanilla-extract/css/fileScope')>();
  fileScope.setFileScope('src/vitest.styles.setup.ts', 'mindroom-client');
  return fileScope;
});
