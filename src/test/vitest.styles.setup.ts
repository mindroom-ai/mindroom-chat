import { setFileScope } from '@vanilla-extract/css/fileScope';

// Unit tests run without the vanilla-extract plugin, which gives each `*.css.ts` module a file
// scope to register its classes under. One scope for every test lets a style module load as it
// is wherever a test does not mock it, so a component can use another component's class.
// @vanilla-extract/css loads outside Vitest's module graph (as Node loads it), so the scope set
// here is the one its style functions read, and `vi.resetModules()` leaves it in place.
setFileScope('src/test/vitest.styles.setup.ts', 'mindroom-client');
