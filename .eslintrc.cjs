/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');

// Lane P: the first column of every docs/provenance/portable*.tsv list, whose code keeps its
// ported logic.
function lanePPaths() {
  const provenance = path.join(__dirname, 'docs', 'provenance');
  return fs
    .readdirSync(provenance)
    .filter((name) => /^portable.*\.tsv$/.test(name))
    .flatMap((name) => fs.readFileSync(path.join(provenance, name), 'utf8').split('\n'))
    .map((row) => row.split('\t')[0])
    .filter(Boolean);
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

// Lane C styles follow the reading direction: a right-to-left language mirrors the interface,
// which logical properties (inline start and end) do by themselves, while a physical left or right
// stays where it is. no-restricted-syntax finds physical sides in the style objects of Lane C
// sources (tests excepted): vanilla-extract objects in *.css.ts files, inline `style` props, and
// any object with a property name only CSS uses (paddingRight, borderLeft). `left` and `right`
// count only in a *.css.ts file (where a variant named `left` is an object, not a value) and in a
// `style` prop, because elsewhere they are often coordinates or scroll offsets.
//
// What stays physical: a property whose value names a safe-area inset, because the notch and the
// rounded corners are physical edges of the screen. Any other side that must stay physical takes
// `// eslint-disable-next-line no-restricted-syntax -- <why it stays>` on the line before it.
const PHYSICAL_NAME = String.raw`/^((margin|padding|scrollMargin|scrollPadding)(Left|Right)|border(Left|Right)(Width|Style|Color)?|border(Top|Bottom)(Left|Right)Radius|(margin|padding|scroll-margin|scroll-padding)-(left|right)|border-(left|right)(-(width|style|color))?|border-(top|bottom)-(left|right)-radius)$/`;
const SIDE_KEYWORD_NAME = String.raw`/^(textAlign|text-align|float|clear|justifyContent|justify-content|justifyItems|justify-items|justifySelf|justify-self)$/`;
const BOX_SHORTHAND = String.raw`/^(margin|padding|inset|scrollMargin|scroll-margin|scrollPadding|scroll-padding|borderWidth|border-width|borderStyle|border-style|borderColor|border-color)$/`;
const SIDE = '/^(left|right)$/';
const SAFE_AREA = '/safe-area-inset-(left|right)/';
// A property of an object literal (not of a destructuring pattern) with a key that matches; keys
// may be identifiers or strings.
const styleProperty = (key) =>
  `ObjectExpression > Property:matches([key.name=${key}], [key.value=${key}])`;
const NOT_SAFE_AREA = `:not(:has(Literal[value=${SAFE_AREA}])):not(:has(TemplateElement[value.raw=${SAFE_AREA}]))`;
// A four-part box shorthand ("0 S200 0 S400") gives the right and left sides their own values. In
// a string, a part is a run without spaces or a parenthesized group such as calc(1px + 2px). In a
// template literal, three runs of spaces in the text around its ${...} values mean four parts,
// whether one text holds them or several do (spaces inside a calc() count too there; write such a
// value another way or leave a disable comment).
const PART = String.raw`([^\s()]|\(([^()]|\([^()]*\))*\))+`;
const FOUR_PARTS = String.raw`/^\s*${PART}(\s+${PART}){3}\s*$/`;
const gaps = (count) => String.raw`TemplateElement[value.raw=/^(\S*\s+){${count}}/]`;
const FOUR_PART_TEMPLATE = `TemplateLiteral:matches(${[
  `:has(> ${gaps(3)})`,
  `:has(> ${gaps(2)} ~ ${gaps(1)})`,
  `:has(> ${gaps(1)} ~ ${gaps(2)})`,
  `:has(> ${gaps(1)} ~ ${gaps(1)} ~ ${gaps(1)})`,
].join(', ')})`;
const LOGICAL_NAME_MESSAGE =
  'A physical side does not mirror in right-to-left languages: use the logical property (paddingInlineStart, marginInlineEnd, borderInlineStart, borderStartEndRadius). A side that must stay physical takes an eslint-disable-next-line comment with the reason.';
const LOGICAL_POSITION_MESSAGE =
  'left and right do not mirror in right-to-left languages: use insetInlineStart, insetInlineEnd or insetInline. A side that must stay physical takes an eslint-disable-next-line comment with the reason.';
const SIDE_KEYWORD_MESSAGE =
  "'left' and 'right' do not mirror in right-to-left languages: use 'start' or 'end'.";
const FOUR_PART_MESSAGE =
  'A four-part shorthand sets the right and left sides physically: give the block and inline sides instead (paddingBlock and paddingInline, marginBlock and marginInline, insetBlock and insetInline).';
const LOGICAL_SIDES = [
  { selector: `${styleProperty(PHYSICAL_NAME)}${NOT_SAFE_AREA}`, message: LOGICAL_NAME_MESSAGE },
  {
    selector: `${styleProperty(SIDE_KEYWORD_NAME)}[value.value=${SIDE}]`,
    message: SIDE_KEYWORD_MESSAGE,
  },
  {
    selector: `${styleProperty(BOX_SHORTHAND)}[value.value=${FOUR_PARTS}]${NOT_SAFE_AREA}`,
    message: FOUR_PART_MESSAGE,
  },
  {
    selector: `${styleProperty(BOX_SHORTHAND)} > ${FOUR_PART_TEMPLATE}${NOT_SAFE_AREA}`,
    message: FOUR_PART_MESSAGE,
  },
];
const LOGICAL_SIDES_IN_STYLE_PROPS = [
  ...LOGICAL_SIDES,
  {
    selector: `JSXAttribute[name.name='style'] ${styleProperty(SIDE)}${NOT_SAFE_AREA}`,
    message: LOGICAL_POSITION_MESSAGE,
  },
];
const LOGICAL_SIDES_IN_STYLE_FILES = [
  ...LOGICAL_SIDES,
  {
    selector: `${styleProperty(SIDE)}:not([value.type='ObjectExpression'])${NOT_SAFE_AREA}`,
    message: LOGICAL_POSITION_MESSAGE,
  },
];
const LOGICAL_SIDES_EXCLUDED = [
  ...lanePPaths().filter((file) => file.startsWith('src/')),
  '**/*.test.{ts,tsx}',
  '**/__tests__/**',
];

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
    {
      // Physical sides in Lane C styles (see LOGICAL_SIDES above). By pattern rather than the
      // list of files on disk, so text linted under a made-up path gets the rule too.
      files: ['src/**/*.{ts,tsx}'],
      excludedFiles: LOGICAL_SIDES_EXCLUDED,
      rules: { 'no-restricted-syntax': ['error', ...LOGICAL_SIDES_IN_STYLE_PROPS] },
    },
    {
      // A vanilla-extract file is styles throughout, so `left` and `right` count anywhere in it.
      files: ['src/**/*.css.ts'],
      excludedFiles: LOGICAL_SIDES_EXCLUDED,
      rules: { 'no-restricted-syntax': ['error', ...LOGICAL_SIDES_IN_STYLE_FILES] },
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
