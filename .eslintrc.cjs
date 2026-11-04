/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');

// Lane C TypeScript on disk: the files tsconfig.json compiles (`src`, `e2e` and two configs)
// minus Lane P, the first column of every docs/provenance/portable*.tsv list, whose code keeps
// its ported logic. The list holds only files that exist, because the type-aware rules need each
// file in the TypeScript program; text linted under a made-up path (as surfaceImports.test.ts
// does) gets the other rules only.
function laneCTypeScriptFiles() {
  const provenance = path.join(__dirname, 'docs', 'provenance');
  const laneP = new Set(
    fs
      .readdirSync(provenance)
      .filter((name) => /^portable.*\.tsv$/.test(name))
      .flatMap((name) => fs.readFileSync(path.join(provenance, name), 'utf8').split('\n'))
      .map((row) => row.split('\t')[0])
  );
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
  'Use the shared surface from src/app/components/glass/GlassPrimitives instead of the raw folds component.';
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

// Lane C code places pop-outs and tooltips in reading order through the directional wrappers,
// which mirror folds' physical sides in a right-to-left interface; only the wrapper module itself
// uses folds' own components. ESLint keys `paths` by module name, so this second restriction on
// `folds` is a pattern.
const DIRECTIONAL_COMPONENTS = ['PopOut', 'TooltipProvider'];
const DIRECTIONAL_RESTRICTIONS = {
  paths: GLASS_RESTRICTIONS.paths,
  patterns: [
    ...GLASS_RESTRICTIONS.patterns,
    {
      group: ['folds'],
      importNames: DIRECTIONAL_COMPONENTS,
      message:
        'Use PopOut and TooltipProvider from src/app/components/directional, which place them in reading order.',
    },
  ],
};

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  env: { browser: true, es2022: true, node: true },
  settings: { react: { version: '18.2' } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import', 'jsx-a11y'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'prettier',
  ],
  ignorePatterns: ['node_modules/', 'dist/', 'test-results/', 'playwright-report/', '.baspowers/'],
  rules: {
    // TypeScript checks prop types; the React prop-types rule would only duplicate it.
    'react/prop-types': 'off',
    // Lane P files carry `eslint-disable` comments for rules from these plugins,
    // so the plugins load; their stricter rules stay off because Lane P code predates them.
    'import/first': 'off',
    'import/no-relative-packages': 'off',
    'jsx-a11y/no-static-element-interactions': 'off',
    'jsx-a11y/role-supports-aria-props': 'off',
    'jsx-a11y/no-autofocus': 'off',
    // Component factories and test doubles return anonymous components.
    'react/display-name': 'off',
    // Files that still import React for the classic JSX transform keep working.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^(React|_)',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    'prefer-const': 'warn',
    'no-restricted-imports': ['error', GLASS_RESTRICTIONS],
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
      // Type-aware rules for Lane C TypeScript: the files tsconfig.json compiles, minus Lane P.
      // Types come from tsconfig.strict.json, whose unchecked index access `just strict` enforces.
      files: laneCTypeScriptFiles(),
      parserOptions: { project: './tsconfig.strict.json', tsconfigRootDir: __dirname },
      rules: {
        // react-test-renderer's synchronous `act` answers a `DebugPromiseLike`, a thenable its
        // types make impossible to await; it is not a floating promise.
        '@typescript-eslint/no-floating-promises': [
          'error',
          {
            allowForKnownSafePromises: [
              { from: 'package', name: 'DebugPromiseLike', package: 'react-test-renderer' },
            ],
          },
        ],
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/await-thenable': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/no-unnecessary-type-assertion': 'error',
        '@typescript-eslint/no-unsafe-enum-comparison': 'error',
        'no-restricted-imports': ['error', DIRECTIONAL_RESTRICTIONS],
      },
    },
    // The two wrappers come after the Lane C block, whose import rule they relax.
    {
      // The directional wrappers place folds' own pop-outs and tooltips.
      files: ['src/app/components/directional/index.tsx'],
      rules: {
        'no-restricted-imports': ['error', GLASS_RESTRICTIONS],
      },
    },
    {
      // The adapter wraps the raw folds surfaces.
      files: ['src/app/components/glass/GlassPrimitives.tsx'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
