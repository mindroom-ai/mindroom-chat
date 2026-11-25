import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalIgnores } from 'eslint/config';

import {
  DIRECTIONAL_COMPONENTS,
  LINTED_FILES,
  RUNTIME_GLOBALS,
  TYPE_AWARE_RULES,
  createCommonConfigs,
  logicalSidesOverrides,
} from './scripts/eslint-shared.mjs';

const ROOT_DIR = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));

// TypeScript on disk: the files tsconfig.json compiles (`src`, `e2e` and config files). The list
// holds only files that exist, because the type-aware rules need each file in the TypeScript
// program; text linted under a made-up path (as surfaceImports.test.ts does) gets the other rules
// only.
function typeScriptFiles() {
  const sources = ['src', 'e2e', 'electron', 'scripts'].flatMap((dir) =>
    fs
      .readdirSync(path.join(ROOT_DIR, dir), { recursive: true })
      .map((file) => path.posix.join(dir, String(file).split(path.sep).join('/')))
  );
  return [
    ...sources,
    'vitest.config.ts',
    'playwright.config.ts',
    'playwright.electron.config.ts',
  ].filter((file) => /\.tsx?$/.test(file));
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
// itself uses folds' own components.
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

const DESKTOP_BRIDGE_MESSAGE =
  'Use desktopBridge or isDesktopApp from src/app/lib/nativeShell instead.';
const DESKTOP_BRIDGE_PROPERTIES = [
  { object: 'window', property: 'mindroomDesktop', message: DESKTOP_BRIDGE_MESSAGE },
  { object: 'globalThis', property: 'mindroomDesktop', message: DESKTOP_BRIDGE_MESSAGE },
];
const DESKTOP_BRIDGE_SYNTAX = [
  {
    selector: [
      "VariableDeclarator[init.name=/^(window|globalThis)$/] > ObjectPattern.id > Property[key.name='mindroomDesktop']",
      "VariableDeclarator[init.name=/^(window|globalThis)$/] > ObjectPattern.id > Property[key.value='mindroomDesktop']",
      "AssignmentExpression[right.name=/^(window|globalThis)$/] > ObjectPattern.left > Property[key.name='mindroomDesktop']",
      "AssignmentExpression[right.name=/^(window|globalThis)$/] > ObjectPattern.left > Property[key.value='mindroomDesktop']",
      "MemberExpression[computed=true][object.name=/^(window|globalThis)$/][property.value='mindroomDesktop']",
    ].join(', '),
    message: DESKTOP_BRIDGE_MESSAGE,
  },
];

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
  ['avatars', 'navigation', 'plugins', 'rich-text', 'server-admin', 'ui-actions', 'usage'],
  ['computer', 'emoji', 'event-store', 'models'],
  ['approvals', 'bug-reports', 'calls', 'connections', 'editor'],
  ['members', 'messages'],
  ['canvas', 'composer', 'notifications', 'schedules', 'search', 'subagents'],
  ['rooms', 'threads'],
  ['account', 'activity', 'background-jobs', 'quick-capture', 'spaces', 'timeline'],
  ['desktop-access'],
  ['invites', 'local-mindroom', 'room'],
  ['settings', 'tour'],
  ['command-palette'],
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
// Tests and their helpers (the files config/tsconfig.app.json leaves out) may import any layer.
const LAYERS_EXEMPT = [...TESTS, '**/*.test.shared.ts', '**/test-utils/**', '**/testUtils.ts'];

export default [
  // Match ESLint 8's recursive directory ignores and default dotfile/dot-directory ignores
  // (including `.baspowers/` and `.cache/` at any depth).
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/.*/**',
    '**/.*',
  ]),
  // Config covers .jsx for explicit checks; package.json "lint" limits directory globs to .ts,.tsx,.js,.mjs,.cjs.
  ...createCommonConfigs(),
  {
    name: 'mindroom/node-globals',
    files: [
      'scripts/**/*.{js,mjs,cjs}',
      '*.config.{js,mjs,cjs}',
      'eslint.config*.mjs',
      'electron/*.{js,mjs,cjs}',
      'electron/main/**/*.{js,mjs,cjs}',
      'e2e/helpers/**/*.{js,mjs,cjs}',
      'e2e/rtc/**/*.{js,mjs,cjs}',
      'e2e/fixtures/live/**/*.{js,mjs,cjs}',
      'src/app/plugins/__fixtures__/example-plugin/build.mjs',
    ],
    languageOptions: {
      globals: RUNTIME_GLOBALS.node,
    },
  },
  {
    name: 'mindroom/browser-globals',
    files: [
      'src/**/*.{js,jsx,mjs,cjs}',
      'public/**/*.js',
      'ios/Tests/public/**/*.js',
      'e2e/fixtures/**/*.{js,jsx,mjs}',
    ],
    ignores: [
      'src/**/*Worklet.js',
      'src/sw/**',
      'src/app/plugins/__fixtures__/example-plugin/build.mjs',
      'e2e/fixtures/live/**',
    ],
    languageOptions: {
      globals: RUNTIME_GLOBALS.browser,
    },
  },
  {
    name: 'mindroom/audioworklet-globals',
    files: ['src/**/*Worklet.js'],
    languageOptions: {
      globals: RUNTIME_GLOBALS.audioWorklet,
    },
  },
  {
    name: 'mindroom/preload-globals',
    files: ['electron/preload.{ts,js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...RUNTIME_GLOBALS.browser,
        ...RUNTIME_GLOBALS.node,
      },
    },
  },
  {
    name: 'mindroom/serviceworker-globals',
    files: ['src/sw/**/*.{ts,js,mjs}'],
    languageOptions: {
      globals: RUNTIME_GLOBALS.serviceworker,
    },
  },
  {
    files: LINTED_FILES,
    rules: {
      'no-restricted-imports': ['error', IMPORT_RESTRICTIONS],
    },
  },
  {
    // CommonJS files load modules with `require`.
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
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
    ignores: ['e2e/helpers/webkit.ts'],
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
    // Type-aware rules for the TypeScript that tsconfig.json compiles. Types come from
    // config/tsconfig.strict.json, whose unchecked index access `just strict` enforces.
    files: typeScriptFiles(),
    languageOptions: {
      parserOptions: { project: './config/tsconfig.strict.json', tsconfigRootDir: ROOT_DIR },
    },
    rules: TYPE_AWARE_RULES,
  },
  {
    // Only nativeShell.ts reads the Electron preload bridge (property access, destructuring,
    // or bracket lookup). Placed before logicalSidesOverrides, which appends the same syntax
    // checks so neither override drops the other's rules.
    files: ['src/**/*.{ts,tsx,js,jsx,mjs}'],
    ignores: ['src/app/lib/nativeShell.ts'],
    rules: {
      'no-restricted-properties': ['error', ...DESKTOP_BRIDGE_PROPERTIES],
      'no-restricted-syntax': ['error', ...DESKTOP_BRIDGE_SYNTAX],
    },
  },
  // Physical sides in styles (scripts/eslint-shared.mjs), keeping the bridge syntax checks.
  ...logicalSidesOverrides('src/', TESTS).map((override) => ({
    ...override,
    rules: {
      ...override.rules,
      'no-restricted-syntax': [...override.rules['no-restricted-syntax'], ...DESKTOP_BRIDGE_SYNTAX],
    },
  })),
  {
    // Domain layers (LAYERS above). Zones resolve from this directory, so the
    // rule does not depend on the directory ESLint runs in.
    files: ['src/**/*.{ts,tsx,js,jsx,mjs}'],
    ignores: LAYERS_EXEMPT,
    rules: {
      'import/no-restricted-paths': ['error', { basePath: ROOT_DIR, zones: LAYER_ZONES }],
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
];
