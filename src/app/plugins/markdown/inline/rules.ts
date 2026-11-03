import { findInlineLatexMatch } from '../../math';
import { restoreCodeSource } from './code';
import type { InlineMDMatcher, InlineMDRule } from './type';

const WHITESPACE = /\s/;

const isEscaped = (text: string, index: number): boolean => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

/** A match in the shape `String.prototype.match` returns: the whole match, then its parts. */
const toMatch = (parts: string[], index: number, input: string): RegExpMatchArray =>
  Object.assign(parts, { index, input }) as RegExpMatchArray;

type DelimiterOptions = {
  delimiter: string;
  /** Besides whitespace, characters that keep a delimiter in front of them from opening. */
  notAfterOpener?: string;
  /** Besides whitespace, characters that keep a delimiter after them from closing. */
  notBeforeCloser?: string;
  /** Characters that keep a delimiter in front of them from closing. */
  notAfterCloser?: string;
};

const isOneOf = (character: string | undefined, characters: string): boolean =>
  character !== undefined && characters.includes(character);

/**
 * Finds text between two delimiters, such as `**bold**`: the first delimiter that can open, up to
 * the first one after it that can close, with something in between. An opener has no whitespace
 * after it and a closer none before it; an escaped delimiter does neither. If the first opener
 * finds no closer, no later one can, so one pass over the text is enough.
 */
const delimitedMatcher =
  ({
    delimiter,
    notAfterOpener = '',
    notBeforeCloser = '',
    notAfterCloser = '',
  }: DelimiterOptions): InlineMDMatcher =>
  (text) => {
    const size = delimiter.length;
    let opener = -1;
    for (let at = text.indexOf(delimiter); at >= 0; at = text.indexOf(delimiter, at + 1)) {
      if (isEscaped(text, at)) continue;
      const before = text[at - 1];
      const after = text[at + size];
      if (
        opener >= 0 &&
        at > opener + size &&
        !WHITESPACE.test(before ?? '') &&
        !isOneOf(before, notBeforeCloser) &&
        !isOneOf(after, notAfterCloser)
      ) {
        return toMatch(
          [text.slice(opener, at + size), text.slice(opener + size, at)],
          opener,
          text
        );
      }
      if (
        opener < 0 &&
        after !== undefined &&
        !WHITESPACE.test(after) &&
        !isOneOf(after, notAfterOpener)
      ) {
        opener = at;
      }
    }
    return null;
  };

/** `**bold**` */
export const BoldRule: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '**', notAfterCloser: '*' }),
  html: (parseInline, match) => `<strong data-md="**">${parseInline(match[1])}</strong>`,
};

/** `*italic*`; a single star next to another one belongs to bold text, as in `*a **b** c*`. */
export const ItalicRule1: InlineMDRule = {
  match: delimitedMatcher({
    delimiter: '*',
    notAfterOpener: '*',
    notBeforeCloser: '*',
    notAfterCloser: '*',
  }),
  html: (parseInline, match) => `<i data-md="*">${parseInline(match[1])}</i>`,
};

/**
 * `_italic_`, also inside words as in chat messages, so `snake_case_name` italicizes `case` and
 * `__init__` nests two italics; the closer is the last of a run of underscores.
 */
export const ItalicRule2: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '_', notAfterCloser: '_' }),
  html: (parseInline, match) => `<i data-md="_">${parseInline(match[1])}</i>`,
};

/** `~~strikethrough~~` */
export const StrikeRule: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '~~', notAfterCloser: '~' }),
  html: (parseInline, match) => `<s data-md="~~">${parseInline(match[1])}</s>`,
};

/** `||spoiler||`, sent as a Matrix spoiler. */
export const SpoilerRule: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '||', notAfterCloser: '|' }),
  html: (parseInline, match) =>
    `<span data-md="||" data-mx-spoiler>${parseInline(match[1])}</span>`,
};

// The destination may hold one level of parentheses, as Wikipedia links do.
const LINK_REG = /\[([^[\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/;

/** `[label](url)`; the label may hold inline Markdown. */
export const LinkRule: InlineMDRule = {
  match: (text) => text.match(LINK_REG),
  html: (parseInline, match) => `<a data-md href="${match[2]}">${parseInline(match[1])}</a>`,
};

/**
 * `$latex$`, sent as Matrix math (`data-mx-maths`). The delimiters follow `findInlineLatexMatch`,
 * which leaves prices such as `$5` and `$1,000.00$` alone. The LaTeX goes into the attribute and
 * the fallback text as written: the input is already HTML-escaped.
 */
export const InlineMathRule: InlineMDRule = {
  match: (text) => {
    const found = findInlineLatexMatch(text);
    return found ? toMatch([found.fullMatch, found.latex], found.start, text) : null;
  },
  html: (_parseInline, match) => {
    const latex = restoreCodeSource(match[1]);
    return `<span data-mx-maths="${latex}">${latex}</span>`;
  },
};

/** Characters a backslash keeps literal, as `\*` for a star. */
export const ESCAPABLE_CHARACTERS = '\\`*_~|$[]()#+-.!>{}:;=?@^%,/';

const ESCAPE_REG = /\\([\\`*_~|$[\]()#+\-.!>{}:;=?@^%,/])/;

/** `\*`: a backslash before punctuation shows the punctuation as written. */
export const EscapeRule: InlineMDRule = {
  match: (text) => text.match(ESCAPE_REG),
  html: (_parseInline, match) => match[1],
};

/** Every inline rule of a chat message, in priority order for matches at the same position. */
export const INLINE_MD_RULES: InlineMDRule[] = [






  InlineMathRule,
  EscapeRule,
];
