/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');

// Lane P: the files of every docs/provenance/portable*.tsv list, at the paths
// docs/provenance/moves.tsv gives them, which the type-aware rules leave out.
const provenancePaths = require('./scripts/provenance-paths.cjs');
const {
  COMMON,
  DIRECTIONAL_COMPONENTS,
  TYPE_AWARE_RULES,
  logicalSidesOverrides,
} = require('./scripts/eslint-shared.cjs');

function lanePPaths() {
  return [...provenancePaths.lanePPaths(__dirname).keys()];
}

// Lane C TypeScript on disk: the files tsconfig.json compiles (`src`, `e2e` and two configs)
// minus Lane P. The list holds only files that exist, because the type-aware rules need each
// file in the TypeScript program; text linted under a made-up path (as surfaceImports.test.ts
// does) gets the other rules only.
function laneCTypeScriptFiles() {
  const laneP = new Set(lanePPaths());
  const sources = ['src', 'e2e'].flatMap((dir) =>
    fs
      .readdirSync(path.join(__dirname, dir), { recursive: true })
      .map((file) => path.posix.join(dir, String(file).split(path.sep).join('/')))
  );
  return [...sources, 'vitest.config.ts', 'playwright.config.ts'].filter(
    (file) => /\.tsx?$/.test(file) && !laneP.has(file)
  );
}

// Menus, dialogs, modals and headers come from the glass primitives, which give every surface
// the same material; only the adapter itself may use the raw folds components.
const GLASS_SURFACE_MESSAGE =
  'Use the shared surface from src/app/ui/glass/GlassPrimitives instead of the raw folds component.';
const RAW_FOLDS_SURFACES = ['default', 'Menu', 'MenuItem', 'Modal', 'Dialog', 'Header'];
const GLASS_RESTRICTIONS = {
  paths: [
    // Named and default imports of the raw surfaces; `import *` and `export *` count too.
    { name: 'folds', importNames: RAW_FOLDS_SURFACES, message: GLASS_SURFACE_MESSAGE },
    { name: 'folds/dist', message: GLASS_SURFACE_MESSAGE },
  ],
  patterns: [
    {
      // Any deep import of folds, except its stylesheet.
      group: ['folds/*', '!folds/dist', 'folds/dist/*', '!folds/dist/style.css'],
      message: GLASS_SURFACE_MESSAGE,
    },
  ],
};

// Module-level atoms come from jotai's own `atom`, which the account state test follows to find
// account state an account would leave behind (shell/accountState.test.ts); these entry points and
// factories make atoms past it.
const FOLLOWED_ATOM_MESSAGE =
  "Make the atom with `atom` from 'jotai', which the account state test follows (src/app/shell/accountState.test.ts).";
const ATOM_FACTORIES = [
  'atomWithDefault',
  'atomWithLazy',
  'atomWithObservable',
  'atomWithReducer',
  'atomWithRefresh',
  'atomWithReset',
  'atomWithStorage',
];
// Every file takes its surfaces from the glass primitives above, makes its atoms where the account
// state test follows them, and places pop-outs and tooltips in reading order through the directional
// wrappers, which mirror folds' physical sides in a right-to-left interface; only the wrapper module
// itself uses folds' own components. ESLint keys `paths` by module name, so this second restriction
// on `folds` is a pattern.
const IMPORT_RESTRICTIONS = {
  paths: [
    ...GLASS_RESTRICTIONS.paths,
    { name: 'jotai/vanilla', message: FOLLOWED_ATOM_MESSAGE },
    { name: 'jotai/vanilla/utils', message: FOLLOWED_ATOM_MESSAGE },
    { name: 'jotai/utils', importNames: ATOM_FACTORIES, message: FOLLOWED_ATOM_MESSAGE },
  ],
  patterns: [
    ...GLASS_RESTRICTIONS.patterns,
    {
      group: ['folds'],
      importNames: DIRECTIONAL_COMPONENTS,
      message:
        'Use PopOut and TooltipProvider from src/app/ui/directional, which place them in reading order.',
    },
  ],
};

const TESTS = ['**/*.test.{ts,tsx}', '**/__tests__/**'];

// Domain layers, lowest first (docs/architecture.md "Layers"). A domain imports only domains of a
// lower layer: static, type-only and dynamic imports and re-exports count (the rule does not see an
// inline `import('...')` type), while the folders inside one domain import each other freely.
// Adding a domain means adding it here; src/test/layering.test.ts fails while a folder of src/app
// has no layer.
const LAYERS = [
  ['lib', 'src/boot', 'src/types'],
  ['config', 'i18n', 'preferences', 'routes', 'shortcuts', 'src/sw'],
  ['diagnostics', 'native', 'ui'],
  ['matrix', 'theme'],
  ['avatars', 'models', 'navigation', 'plugins', 'rich-text', 'server-admin', 'ui-actions'],
  ['computer', 'emoji', 'event-store'],
  ['approvals', 'bug-reports', 'calls', 'connections', 'editor'],
  ['background-jobs', 'members', 'messages'],
  ['canvas', 'composer', 'notifications', 'schedules', 'search', 'subagents'],
  ['rooms', 'threads'],
  ['account', 'activity', 'quick-capture', 'spaces', 'timeline'],
  ['command-palette', 'local-mindroom', 'room'],
  ['settings'],
  ['sidebar'],
  ['shell'],
  ['src/index.tsx', 'src/client-sdk'],
];
const domainDir = (domain) => (domain.startsWith('src/') ? `./${domain}` : `./src/app/${domain}`);
// One zone per domain: it may import nothing of its own layer or above.
const LAYER_ZONES = LAYERS.flatMap((layer, index) =>
  layer.map((domain) => ({
    target: domainDir(domain),
    from: LAYERS.slice(index)
      .flat()
      .filter((other) => other !== domain)
      .map(domainDir),
    message: `${domain} (layer ${index}) may import only lower layers; see docs/architecture.md "Layers".`,
  }))
);
// Tests and their helpers (the files tsconfig.app.json leaves out) may import any layer.
const LAYERS_EXEMPT = [...TESTS, '**/*.test.shared.ts', '**/test-utils/**', '**/testUtils.ts'];

module.exports = {
  root: true,
  ...COMMON,
  ignorePatterns: ['node_modules/', 'dist/', 'test-results/', 'playwright-report/', '.baspowers/'],
  rules: {
    ...COMMON.rules,
    'no-restricted-imports': ['error', IMPORT_RESTRICTIONS],
  },
  overrides: [
    {
      // CommonJS files, this config among them, load modules with `require`.
      files: ['**/*.cjs'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // Tests build loose doubles and inline components on purpose.
      files: ['**/*.test.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // A spec's own WebKit comes from e2e/helpers/webkit.ts, whose contexts keep Safari's user
      // agent and block the service worker, whose requests Playwright's WebKit does not route.
      files: ['e2e/**/*.{ts,tsx}'],
      excludedFiles: ['e2e/helpers/webkit.ts'],
      rules: {
        'no-restricted-properties': [
          'error',
          {
            object: 'webkit',
            property: 'launch',
            message: 'Launch WebKit with launchWebKit or onWebKitPage from e2e/helpers/webkit.ts.',
          },
        ],
      },
    },
    {
      // Type-aware rules for Lane C TypeScript: the files tsconfig.json compiles, minus Lane P.
      // Types come from tsconfig.strict.json, whose unchecked index access `just strict` enforces.
      files: laneCTypeScriptFiles(),
      parserOptions: { project: './tsconfig.strict.json', tsconfigRootDir: __dirname },
      rules: TYPE_AWARE_RULES,
    },
    // Physical sides in styles (scripts/eslint-shared.cjs).
    ...logicalSidesOverrides('src/', TESTS),
    {
      // Domain layers (LAYERS above), in both lanes. Zones resolve from this directory, so the
      // rule does not depend on the directory ESLint runs in.
      files: ['src/**/*.{ts,tsx,js,jsx,mjs}'],
      excludedFiles: LAYERS_EXEMPT,
      rules: {
        'import/no-restricted-paths': ['error', { basePath: __dirname, zones: LAYER_ZONES }],
      },
    },
    // The two wrappers relax the import rule that every other file has.
    {
      // The directional wrappers place folds' own pop-outs and tooltips.
      files: ['src/app/ui/directional.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: IMPORT_RESTRICTIONS.paths, patterns: GLASS_RESTRICTIONS.patterns },
        ],
      },
    },
    {
      // The adapter wraps the raw folds surfaces.
      files: ['src/app/ui/glass/GlassPrimitives.tsx'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
