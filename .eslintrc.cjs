/* eslint-env node */
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
  },
  overrides: [
    {
      // Tests build loose doubles and inline components on purpose.
      files: ['**/*.test.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
