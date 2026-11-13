/* eslint-env node */
// What the app's ESLint config (.eslintrc.cjs) shares with the one a client plugin outside this
// repository extends (.eslintrc.plugin.cjs): the parser, plugins and presets, the type-aware rules,
// and the rule that keeps styles in reading order.

// The app turns i18next's escaping off (src/app/i18n/i18n.ts), and a <Trans> puts its values into
// the sentence before react-i18next reads the sentence as markup, so a name holding a tag named
// like one of the sentence's components would add that tag's attributes to it. A <Trans> with
// values escapes them and unescapes the text.
const ESCAPED_TRANS = {
  selector:
    "JSXOpeningElement[name.name='Trans']:has(> JSXAttribute[name.name='values']):matches(:not(:has(> JSXAttribute[name.name='tOptions'])), :not(:has(> JSXAttribute[name.name='shouldUnescape'])))",
  message:
    'A <Trans> with values reads them as markup: give it tOptions={{ interpolation: { escapeValue: true } }} and shouldUnescape.',
};

/** The parser, plugins, presets and rules for every file. */
const COMMON = {
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  env: { browser: true, es2022: true, node: true },
  settings: {
    react: { version: '18.2' },
    // import/no-restricted-paths skips an import it cannot resolve, and the node resolver tries no
    // TypeScript extensions by default.
    'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'] } },
  },
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
    'no-restricted-syntax': ['error', ESCAPED_TRANS],
  },
};

/** The folds components that src/app/ui/directional.tsx places in reading order. */
const DIRECTIONAL_COMPONENTS = ['PopOut', 'TooltipProvider'];

/** Rules that need the types of a TypeScript program (`parserOptions.project`). */
const TYPE_AWARE_RULES = {
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
};

// Styles follow the reading direction: a right-to-left language mirrors the interface,
// which logical properties (inline start and end) do by themselves, while a physical left or right
// stays where it is. no-restricted-syntax finds physical sides in the style objects of the sources
// each config gives `logicalSidesOverrides` (tests excepted): vanilla-extract objects in *.css.ts
// files, inline `style` props, and any object with a property name only CSS uses (paddingRight,
// borderLeft). `left` and `right`
// count only in a *.css.ts file (where a variant named `left` is an object, not a value) and in a
// `style` prop, because elsewhere they are often coordinates or scroll offsets.
//
// What stays physical: a property whose value names a safe-area inset, because the notch and the
// rounded corners are physical edges of the screen; a value that chooses between such an inset and
// a plain string (`phone ? 'env(safe-area-inset-left)' : '24px'`) is physical in its other branch
// and counts. Any other side that must stay physical takes
// `// eslint-disable-next-line no-restricted-syntax -- <why it stays>` on the line before it.
//
// This rule owns no-restricted-syntax for those sources: ESLint overrides replace a rule's options
// instead of merging them, so any other no-restricted-syntax config for these files would drop
// these selectors (or be dropped), and the overrides repeat ESCAPED_TRANS, the one restriction
// every file has. Add a new restriction to the lists below instead.
const PHYSICAL_NAME = String.raw`/^((margin|padding|scrollMargin|scrollPadding)(Left|Right)|border(Left|Right)(Width|Style|Color)?|border(Top|Bottom)(Left|Right)Radius|(margin|padding|scroll-margin|scroll-padding)-(left|right)|border-(left|right)(-(width|style|color))?|border-(top|bottom)-(left|right)-radius)$/`;
const SIDE_KEYWORD_NAME = String.raw`/^(textAlign|text-align|float|clear|justifyContent|justify-content|justifyItems|justify-items|justifySelf|justify-self)$/`;
const BOX_SHORTHAND = String.raw`/^(margin|padding|inset|scrollMargin|scroll-margin|scrollPadding|scroll-padding|borderWidth|border-width|borderStyle|border-style|borderColor|border-color)$/`;
const SIDE = '/^(left|right)$/';
const SAFE_AREA = '/safe-area-inset-(left|right)/';
// Positions that take keywords (`transform-origin: left top`, `background-position: right`).
const POSITION_NAME = String.raw`/^(transformOrigin|transform-origin|backgroundPosition|background-position|backgroundPositionX|background-position-x|objectPosition|object-position|perspectiveOrigin|perspective-origin|maskPosition|mask-position)$/`;
const NAMES_SIDE = String.raw`/\b(left|right)\b/`;
const HAS_SIDE_KEYWORD = `:matches(:has(Literal[value=${NAMES_SIDE}]), :has(TemplateElement[value.raw=${NAMES_SIDE}]))`;
const RADIUS_NAME = String.raw`/^(borderRadius|border-radius)$/`;
// A property of an object literal (not of a destructuring pattern) with a key that matches; keys
// may be identifiers or strings.
const styleProperty = (key) =>
  `ObjectExpression > Property:matches([key.name=${key}], [key.value=${key}])`;
// A value is physical unless it names a safe-area inset, and also when a branch of a choice in it
// is a string that names none.
const BRANCH_WITHOUT_SAFE_AREA = String.raw`:matches(ConditionalExpression, LogicalExpression) > Literal[value=/^(?![\s\S]*safe-area-inset-(left|right))/]`;
const NOT_SAFE_AREA = `:matches(:not(:has(Literal[value=${SAFE_AREA}])):not(:has(TemplateElement[value.raw=${SAFE_AREA}])), :has(${BRANCH_WITHOUT_SAFE_AREA}))`;
// The value of a property, also when it is wrapped in `as const` or `satisfies`.
const valueMatches = (pattern) =>
  `:matches([value.value=${pattern}], [value.expression.value=${pattern}])`;
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
// A border radius of two to four values sets its corners by their physical sides; even two
// values are diagonal (top left and bottom right first). Each side of an elliptical radius'
// slash counts on its own. A template counts when its text has a space and no parentheses or
// slash, since a calc() has spaces of its own.
const RADIUS_PART = String.raw`([^\s()/]|\(([^()]|\([^()]*\))*\))+`;
const SEVERAL_RADII = String.raw`/(^|\/)\s*${RADIUS_PART}(\s+${RADIUS_PART})+\s*(\/|$)/`;
const SEVERAL_RADII_TEMPLATE = String.raw`TemplateLiteral:not(:has(TemplateElement[value.raw=/[()\/]/])):has(TemplateElement[value.raw=/\s/])`;
const LOGICAL_NAME_MESSAGE =
  'A physical side does not mirror in right-to-left languages: use the logical property (paddingInlineStart, marginInlineEnd, borderInlineStart, borderStartEndRadius). A side that must stay physical takes an eslint-disable-next-line comment with the reason.';
const LOGICAL_POSITION_MESSAGE =
  'left and right do not mirror in right-to-left languages: use insetInlineStart, insetInlineEnd or insetInline. A side that must stay physical takes an eslint-disable-next-line comment with the reason.';
const SIDE_KEYWORD_MESSAGE =
  "'left' and 'right' do not mirror in right-to-left languages: use 'start' or 'end'.";
const FOUR_PART_MESSAGE =
  'A four-part shorthand sets the right and left sides physically: give the block and inline sides instead (paddingBlock and paddingInline, marginBlock and marginInline, insetBlock and insetInline).';
const RADIUS_MESSAGE =
  'A border radius of several values sets corners by their physical sides: use borderStartStartRadius, borderStartEndRadius, borderEndStartRadius and borderEndEndRadius.';
const POSITION_KEYWORD_MESSAGE =
  "'left' and 'right' in a position do not mirror in right-to-left languages: compute the side from the reading direction, or take an eslint-disable-next-line comment with the reason.";
const LOGICAL_SIDES = [
  { selector: `${styleProperty(PHYSICAL_NAME)}${NOT_SAFE_AREA}`, message: LOGICAL_NAME_MESSAGE },
  {
    selector: `${styleProperty(SIDE_KEYWORD_NAME)}${valueMatches(SIDE)}`,
    message: SIDE_KEYWORD_MESSAGE,
  },
  {
    selector: `${styleProperty(BOX_SHORTHAND)}${valueMatches(FOUR_PARTS)}${NOT_SAFE_AREA}`,
    message: FOUR_PART_MESSAGE,
  },
  {
    selector: `${styleProperty(BOX_SHORTHAND)} > ${FOUR_PART_TEMPLATE}${NOT_SAFE_AREA}`,
    message: FOUR_PART_MESSAGE,
  },
  {
    selector: `${styleProperty(RADIUS_NAME)}${valueMatches(SEVERAL_RADII)}`,
    message: RADIUS_MESSAGE,
  },
  {
    selector: `${styleProperty(RADIUS_NAME)} > ${SEVERAL_RADII_TEMPLATE}`,
    message: RADIUS_MESSAGE,
  },
  {
    selector: `${styleProperty(POSITION_NAME)}${HAS_SIDE_KEYWORD}`,
    message: POSITION_KEYWORD_MESSAGE,
  },
  {
    // Sides written onto an element's style at once (`Object.assign(el.style, { left })`).
    selector: `CallExpression[callee.object.name='Object'][callee.property.name='assign'][arguments.0.property.name='style'] > ObjectExpression > Property:matches([key.name=${SIDE}], [key.value=${SIDE}])${NOT_SAFE_AREA}`,
    message: LOGICAL_POSITION_MESSAGE,
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

/**
 * The overrides that find physical sides in the TypeScript files under `prefix` (such as `src/`, or
 * '' for every one) other than `excludedFiles`. By pattern rather than the list of files on disk,
 * so text linted under a made-up path gets the rule too.
 * @param {string} prefix
 * @param {string[]} excludedFiles
 */
const logicalSidesOverrides = (prefix, excludedFiles) => [
  {
    files: [`${prefix}**/*.{ts,tsx}`],
    excludedFiles,
    rules: { 'no-restricted-syntax': ['error', ESCAPED_TRANS, ...LOGICAL_SIDES_IN_STYLE_PROPS] },
  },
  {
    // A vanilla-extract file is styles throughout, so `left` and `right` count anywhere in it.
    files: [`${prefix}**/*.css.ts`],
    excludedFiles,
    rules: { 'no-restricted-syntax': ['error', ...LOGICAL_SIDES_IN_STYLE_FILES] },
  },
];

module.exports = { COMMON, DIRECTIONAL_COMPONENTS, TYPE_AWARE_RULES, logicalSidesOverrides };
