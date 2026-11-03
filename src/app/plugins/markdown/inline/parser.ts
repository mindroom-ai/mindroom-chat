import { createInsideUrlTest } from '../../../utils/regex';
import { withProtectedCode } from './code';
import { INLINE_MD_RULES } from './rules';
import type { InlineMDParser, InlineMDRule } from './type';

const WHITESPACE = /\s/;

type FoundMatch = { index: number; match: RegExpMatchArray };

/**
 * Applies `rules` to `text`: the match that starts first wins, the earlier rule on a tie, and the
 * text before it stays as it is. A match that starts inside a URL is skipped, so `https://a.b/_c_`
 * keeps its underscores. A rule's match stays valid until the parse passes its start, so each
 * rule searches the rest of the text once per match it makes, not once per match of any rule.
 */
const applyRules = (text: string, rules: InlineMDRule[], parseInline: InlineMDParser): string => {
  if (text === '') return text;
  const insideUrl = createInsideUrlTest(text);
  const urlEnd = (index: number): number => {
    let end = index;
    while (end < text.length && !WHITESPACE.test(text[end])) end += 1;
    return end;
  };
  const find = (rule: InlineMDRule, from: number): FoundMatch | null => {
    let start = from;
    while (start < text.length) {
      const match = rule.match(start === 0 ? text : text.slice(start));
      if (!match || match.index === undefined) return null;
      const index = start + match.index;
      if (!insideUrl(index)) return { index, match };
      start = Math.max(urlEnd(index), index + 1);
    }
    return null;
  };

  const found: Array<FoundMatch | null | undefined> = rules.map(() => undefined);
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    let best: FoundMatch | null = null;
    let bestRule: InlineMDRule | undefined;
    for (let index = 0; index < rules.length; index += 1) {
      let candidate = found[index];
      if (candidate === undefined || (candidate !== null && candidate.index < cursor)) {
        candidate = find(rules[index], cursor);
        found[index] = candidate;
      }
      if (candidate && (!best || candidate.index < best.index)) {
        best = candidate;
        bestRule = rules[index];
      }
    }
    if (!best || !bestRule) break;
    output += text.slice(cursor, best.index);
    const { length } = best.match[0];
    output += bestRule.html(parseInline, best.match);
    cursor = best.index + length;
    if (length === 0) {
      // A rule that matched nothing would never move on.
      output += text[cursor] ?? '';
      cursor += 1;
    }
  }
  return output + text.slice(cursor);
};

/**
 * Renders inline Markdown with the given rules. Inline code is always handled, before any rule,
 * so Markdown inside it stays literal. The input is HTML-escaped text; the output is HTML.
 */
export const parseInlineMDWithRules = (text: string, rules: InlineMDRule[]): string =>
  withProtectedCode(text, (masked) => {
    const parseInline: InlineMDParser = (part) => applyRules(part, rules, parseInline);
    return parseInline(masked);
  });

/** Renders the inline Markdown of a chat message: code, bold, italic, strikethrough, spoilers, links, math, escapes. */
export const parseInlineMD: InlineMDParser = (text) =>
  parseInlineMDWithRules(text, INLINE_MD_RULES);
