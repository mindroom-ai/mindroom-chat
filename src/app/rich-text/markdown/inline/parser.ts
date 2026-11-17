import { createInsideUrlTest } from '../../../lib/regex';
import { withProtectedCode } from './code';
import { INLINE_MD_RULES } from './rules';
import type { InlineMDParser, InlineMDRule, InlineMDSpan } from './type';

const WHITESPACE = /\s/;

type FoundMatch = { index: number; match: RegExpMatchArray };

/** Hears of each match `applyRules` renders, at its offset in the text, just before rendering it. */
type OnMatch = (rule: InlineMDRule, index: number, match: RegExpMatchArray) => void;

/**
 * Applies `rules` to `text`: the match that starts first wins, the earlier rule on a tie, and the
 * text before it stays as it is. A match that starts inside a URL is skipped, so `https://a.b/_c_`
 * keeps its underscores. A rule's match stays valid until the parse passes its start, so each
 * rule searches the rest of the text once per match it makes, not once per match of any rule.
 */
const applyRules = (
  text: string,
  rules: InlineMDRule[],
  parseInline: InlineMDParser,
  onMatch?: OnMatch
): string => {
  if (text === '') return text;
  const insideUrl = createInsideUrlTest(text);
  const urlEnd = (index: number): number => {
    let end = index;
    while (end < text.length && !WHITESPACE.test(text.charAt(end))) end += 1;
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

  // `found` is unset until the rule is searched, and null once it has no match left.
  const searches: { rule: InlineMDRule; found?: FoundMatch | null }[] = rules.map((rule) => ({
    rule,
  }));
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    let best: FoundMatch | null = null;
    let bestRule: InlineMDRule | undefined;
    for (const search of searches) {
      if (search.found === undefined || (search.found !== null && search.found.index < cursor)) {
        search.found = find(search.rule, cursor);
      }
      const candidate = search.found;
      if (candidate && (!best || candidate.index < best.index)) {
        best = candidate;
        bestRule = search.rule;
      }
    }
    if (!best || !bestRule) break;
    output += text.slice(cursor, best.index);
    const { length } = best.match[0];
    onMatch?.(bestRule, best.index, best.match);
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
 * How deep inline Markdown may nest, as in `**_~~a~~_**`. Text nested deeper stays as written, so
 * a long run of delimiters costs one pass per level up to here and cannot exhaust the call stack.
 */
export const MAX_INLINE_MD_NESTING = 32;

/**
 * Renders inline Markdown with the given rules. Inline code is always handled, before any rule,
 * so Markdown inside it stays literal. The input is HTML-escaped text; the output is HTML.
 * `onSpan` hears of each match of a rule with a `span`, and of each code span, in offsets of
 * `text`; it does not change the output.
 */
export const parseInlineMDWithRules = (
  text: string,
  rules: InlineMDRule[],
  onSpan?: (span: InlineMDSpan) => void
): string =>
  withProtectedCode(
    text,
    (masked, toSource) => {
      let depth = 0;
      // Where the part being parsed starts in `masked`, and where the next nested parse starts;
      // undefined where that is not known, inside a rule without a `span`, so nothing is reported.
      let base: number | undefined = 0;
      let nextBase: number | undefined;
      const onMatch: OnMatch | undefined =
        onSpan &&
        ((rule, index, match) => {
          const shape = base === undefined ? undefined : rule.span?.(match);
          if (base === undefined || !shape) {
            nextBase = undefined;
            return;
          }
          const start = base + index;
          const end = start + (match[0]?.length ?? 0);
          nextBase = start + shape.open;
          const sourceStart = toSource(start);
          const sourceEnd = toSource(end);
          onSpan({
            kind: shape.kind,
            start: sourceStart,
            end: sourceEnd,
            open: toSource(start + shape.open) - sourceStart,
            close: sourceEnd - toSource(end - shape.close),
          });
        });
      const parseInline: InlineMDParser = (part) => {
        if (depth >= MAX_INLINE_MD_NESTING) return part;
        depth += 1;
        const outer = base;
        base = depth === 1 ? 0 : nextBase;
        try {
          return applyRules(part, rules, parseInline, onMatch);
        } finally {
          depth -= 1;
          base = outer;
        }
      };
      return parseInline(masked);
    },
    onSpan
  );

/**
 * The inline Markdown `text` holds, as `parseInlineMD` (or `parseInlineMDWithRules` with `rules`)
 * reads it, in order of where each starts, outer before inner. The input is HTML-escaped text.
 */
export const findInlineMDSpans = (
  text: string,
  rules: InlineMDRule[] = INLINE_MD_RULES
): InlineMDSpan[] => {
  const spans: InlineMDSpan[] = [];
  parseInlineMDWithRules(text, rules, (span) => spans.push(span));
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
};

/** Renders the inline Markdown of a chat message: code, bold, italic, strikethrough, spoilers, links, math, escapes. */
export const parseInlineMD: InlineMDParser = (text) =>
  parseInlineMDWithRules(text, INLINE_MD_RULES);
