/* eslint-env node */
// The ESLint config a client plugin outside this repository extends (docs/development.md "A client
// plugin in its own repository"): the rules of the app's own code, without its lanes and layers,
// and one more, that the plugin imports the app only through the client SDK. The plugin runs this
// app's ESLint from its own directory with `--resolve-plugins-relative-to` this directory, and the
// type-aware rules take the types of the plugin's tsconfig.strict.json there.
const path = require('node:path');
const {
  COMMON,
  DIRECTIONAL_COMPONENTS,
  TYPE_AWARE_RULES,
  logicalSidesOverrides,
} = require('./scripts/eslint-shared.cjs');

const TESTS = ['**/*.test.{ts,tsx}', '**/__tests__/**'];

module.exports = {
  ...COMMON,
  settings: {
    ...COMMON.settings,
    // Real paths, so that an import through a link to the app (`.mindroom-chat`) resolves into
    // the app's directories below.
    'import/resolver': {
      node: { ...COMMON.settings['import/resolver'].node, preserveSymlinks: false },
    },
  },
  ignorePatterns: ['node_modules/', 'dist/'],
  rules: {
    ...COMMON.rules,
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['folds'],
            importNames: DIRECTIONAL_COMPONENTS,
            message:
              'Use PopOut and IconTooltip from @mindroom/client-sdk/ui, which place them in reading order.',
          },
        ],
      },
    ],
    // Any file, wherever the plugin is, that imports a module of the app's src/ or e2e/ by its path.
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          {
            target: path.parse(__dirname).root,
            from: [path.join(__dirname, 'src'), path.join(__dirname, 'e2e')],
            message: 'A plugin imports the app only through @mindroom/client-sdk/<subpath>.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.cjs'],
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
    {
      files: TESTS,
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      // Relative to the directory ESLint runs in: the plugin's.
      files: ['**/*.{ts,tsx}'],
      parserOptions: { project: './tsconfig.strict.json' },
      rules: TYPE_AWARE_RULES,
    },
    ...logicalSidesOverrides('', TESTS),
  ],
};
