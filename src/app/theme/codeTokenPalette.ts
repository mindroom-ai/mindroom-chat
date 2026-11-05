// Syntax colors for the token spans PrismCode renders, one set for light themes and one for dark.
// They draw on the hues of the MindRoom palette (violet keywords, green strings, blue functions)
// and keep a 4.5:1 contrast on every theme's code block background (SurfaceVariant.Container);
// codeTokenPalette.test.ts checks that.

/** A group of Prism token types that share one color. */
export type CodeTokenRole =
  | 'comment'
  | 'punctuation'
  | 'keyword'
  | 'string'
  | 'number'
  | 'function'
  | 'tag'
  | 'property'
  | 'operator';

/** Which Prism token types (and aliases) take each role's color. */
export const CODE_TOKEN_TYPES: Record<CodeTokenRole, readonly string[]> = {
  comment: ['comment', 'prolog', 'doctype', 'cdata', 'shebang'],
  punctuation: ['punctuation'],
  keyword: ['keyword', 'atrule', 'important', 'rule', 'control-flow'],
  string: ['string', 'char', 'attr-value', 'regex', 'template-string', 'inserted'],
  number: ['number', 'boolean', 'constant', 'symbol', 'unit', 'decorator', 'annotation'],
  function: ['function', 'function-name', 'class-name', 'maybe-class-name'],
  tag: ['tag', 'selector', 'deleted', 'entity'],
  property: ['property', 'attr-name', 'key', 'variable', 'builtin', 'parameter'],
  operator: ['operator', 'url'],
};

export type CodeTokenColors = Record<CodeTokenRole, string>;

export const LIGHT_CODE_TOKEN_COLORS: CodeTokenColors = {
  comment: '#626276',
  punctuation: '#55556A',
  keyword: '#7339BE',
  string: '#1B6F41',
  number: '#9C4E08',
  function: '#2C58AA',
  tag: '#AA3133',
  property: '#166A69',
  operator: '#55556A',
};

export const DARK_CODE_TOKEN_COLORS: CodeTokenColors = {
  comment: '#A6A6B4',
  punctuation: '#C2C2CC',
  keyword: '#CBB2FB',
  string: '#9CD8B0',
  number: '#F2C38D',
  function: '#A3C9FE',
  tag: '#F4ADA8',
  property: '#90D8D4',
  operator: '#C2C2CC',
};

/** Roles drawn in italics. */
export const ITALIC_CODE_TOKEN_ROLES: readonly CodeTokenRole[] = ['comment'];
