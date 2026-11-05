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

/** A capture group of `match`; every group these rules read always takes part in a match. */
const capture = (match: RegExpMatchArray, group: number): string => match[group] ?? '';

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
  html: (parseInline, match) => `<strong data-md="**">${parseInline(capture(match, 1))}</strong>`,
};

/** `*italic*`; a single star next to another one belongs to bold text, as in `*a **b** c*`. */
export const ItalicRule1: InlineMDRule = {
  match: delimitedMatcher({
    delimiter: '*',
    notAfterOpener: '*',
    notBeforeCloser: '*',
    notAfterCloser: '*',
  }),
  html: (parseInline, match) => `<i data-md="*">${parseInline(capture(match, 1))}</i>`,
};

/**
 * `_italic_`, also inside words as in chat messages, so `snake_case_name` italicizes `case` and
 * `__init__` nests two italics; the closer is the last of a run of underscores.
 */
export const ItalicRule2: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '_', notAfterCloser: '_' }),
  html: (parseInline, match) => `<i data-md="_">${parseInline(capture(match, 1))}</i>`,
};

/** `~~strikethrough~~` */
export const StrikeRule: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '~~', notAfterCloser: '~' }),
  html: (parseInline, match) => `<s data-md="~~">${parseInline(capture(match, 1))}</s>`,
};

/** `||spoiler||`, sent as a Matrix spoiler. */
const SpoilerRule: InlineMDRule = {
  match: delimitedMatcher({ delimiter: '||', notAfterCloser: '|' }),
  html: (parseInline, match) =>
    `<span data-md="||" data-mx-spoiler>${parseInline(capture(match, 1))}</span>`,
};

// The destination may hold one level of parentheses, as Wikipedia links do, but no brackets, so
// a link that is refused never hides another one starting inside it.
const LINK_REG = /\[([^[\]]+)\]\(((?:[^\s()[\]]|\([^\s()[\]]*\))+)\)/g;

// The schemes the message sanitizer (`rich-text/sanitize`) keeps in links; any other destination,
// relative ones included, stays text even before the sanitizer runs.
const LINK_SCHEME_REG = /^(?:https?|ftp|mailto|magnet):/i;

/** `[label](url)` with an http(s), ftp, mailto or magnet URL; the label may hold inline Markdown. */
export const LinkRule: InlineMDRule = {
  match: (text) => {
    LINK_REG.lastIndex = 0;
    for (let match = LINK_REG.exec(text); match; match = LINK_REG.exec(text)) {
      if (LINK_SCHEME_REG.test(capture(match, 2))) return match;
    }
    return null;
  },
  html: (parseInline, match) =>
    `<a data-md href="${capture(match, 2)}">${parseInline(capture(match, 1))}</a>`,
};

/**
 * `$latex$`, sent as Matrix math (`data-mx-maths`). The delimiters follow `findInlineLatexMatch`,
 * which leaves prices such as `$5` and `$1,000.00$` alone. The LaTeX goes into the attribute and
 * the fallback text as written: the input is already HTML-escaped.
 */
const InlineMathRule: InlineMDRule = {
  match: (text) => {
    const found = findInlineLatexMatch(text);
    return found ? toMatch([found.fullMatch, found.latex], found.start, text) : null;
  },
  html: (_parseInline, match) => {
    const latex = restoreCodeSource(capture(match, 1));
    return `<span data-mx-maths="${latex}">${latex}</span>`;
  },
};

const ESCAPE_REG = /\\([\\`*_~|$[\]()#+\-.!>{}:;=?@^%,/])/;

/** `\*`: a backslash before punctuation shows the punctuation as written. */
export const EscapeRule: InlineMDRule = {
  match: (text) => text.match(ESCAPE_REG),
  html: (_parseInline, match) => capture(match, 1),
};

/** Every inline rule of a chat message, in priority order for matches at the same position. */
export const INLINE_MD_RULES: InlineMDRule[] = [
  // Of these, only bold and star italics start on the same character, and a star italic never
  // opens in front of a second star, so they cannot tie; bold still goes first for clarity.
  BoldRule,
  ItalicRule1,
  ItalicRule2,
  StrikeRule,
  SpoilerRule,
  LinkRule,
  InlineMathRule,
  EscapeRule,
];
