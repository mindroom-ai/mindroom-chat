import { setFileScope } from '@vanilla-extract/css/fileScope';

// Unit tests run without the vanilla-extract plugin, which gives each `*.css.ts` module a file
// scope to register its classes under. One scope for every test lets a style module load as it
// is wherever a test does not mock it, so a component can use another component's class.
setFileScope('src/vitest.styles.setup.ts', 'mindroom-client');
