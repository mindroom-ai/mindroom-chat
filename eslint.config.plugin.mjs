// The ESLint flat config a client plugin outside this repository re-exports or extends
// (docs/development.md "A client plugin in its own repository"): the rules of the app's own code,
// without its layers, and one more, that the plugin imports the app only through the client SDK.
// The plugin runs this app's ESLint from its own directory, and the type-aware rules take the
// types of the plugin's tsconfig.strict.json there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalIgnores } from 'eslint/config';
import { createNodeResolver } from 'eslint-plugin-import-x';

import {
  DIRECTIONAL_COMPONENTS,
  LINTED_FILES,
  RESOLVER_EXTENSIONS,
  TYPE_AWARE_RULES,
  createCommonConfigs,
  logicalSidesOverrides,
} from './scripts/eslint-shared.mjs';

const ROOT_DIR = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));

// The plugin's end-to-end specs in its e2e/ count as tests, as the app's own do.
const TESTS = ['**/*.test.{ts,tsx}', '**/__tests__/**', 'e2e/**'];

// Real paths (`symlinks: true`), so an import through a link to the app (`.mindroom-chat`)
// resolves into the app's directories below; and `.js`/`.jsx`/`.mjs` map to TypeScript sources so
// `./registry.js` finds `registry.ts` as TypeScript resolves it.
const pluginResolver = createNodeResolver({
  extensions: RESOLVER_EXTENSIONS,
  extensionAlias: {
    '.js': ['.js', '.ts', '.tsx', '.jsx', '.mjs'],
    '.jsx': ['.jsx', '.ts', '.tsx', '.js', '.mjs'],
    '.mjs': ['.mjs', '.ts', '.tsx', '.js', '.jsx'],
  },
  symlinks: true,
});

export default [
  globalIgnores(['node_modules/', 'dist/']),
  ...createCommonConfigs({ resolver: pluginResolver }),
  {
    files: LINTED_FILES,
    rules: {
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
              target: path.parse(ROOT_DIR).root,
              from: [path.join(ROOT_DIR, 'src'), path.join(ROOT_DIR, 'e2e')],
              message:
                'A plugin imports the app only through @mindroom/client-sdk/<subpath>, and its specs the e2e helpers through @mindroom/e2e/<helper>.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: TESTS,
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // As in the app's own specs: WebKit comes from @mindroom/e2e/webkit, whose contexts keep
    // Safari's user agent and block the service worker.
    files: ['e2e/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'webkit',
          property: 'launch',
          message: 'Launch WebKit with launchWebKit or onWebKitPage from @mindroom/e2e/webkit.',
        },
      ],
    },
  },
  {
    // Relative to the directory ESLint runs in: the plugin's.
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { project: './tsconfig.strict.json' },
    },
    rules: TYPE_AWARE_RULES,
  },
  ...logicalSidesOverrides('', TESTS),
];
