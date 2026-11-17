import type { InlineMDParser } from '../inline/type';
import { BLOCK_MD_RULES } from './rules';
import type { BlockMDRule } from './type';

type FoundBlock = { index: number; match: RegExpMatchArray };

const plainText: InlineMDParser = (text) => text;

/** Text outside blocks: each line rendered inline, and every line break kept as `<br/>`. */
const renderText = (text: string, parseInline: InlineMDParser): string =>
  text
    .split('\n')
    .map((line) => parseInline(line))
    .join('<br/>');

type BlockFinder = (from: number) => FoundBlock | null;

/** Finds a rule's first block at or after `from`, through its scanner when it has one. */
const createBlockFinder = (text: string, rule: BlockMDRule): BlockFinder => {
  let scanned: ((from: number) => RegExpMatchArray | null) | undefined;
  return (from) => {
    if (rule.scan) scanned ??= rule.scan(text);
    const match = scanned ? scanned(from) : rule.match(from === 0 ? text : text.slice(from));
    if (!match || match.index === undefined || match[0].length === 0) return null;
    return { index: scanned ? match.index : from + match.index, match };
  };
};

/** A block a rule found: where it starts and ends in the text, and the rule's match. */
export type FoundBlockMD = {
  rule: BlockMDRule;
  match: RegExpMatchArray;
  start: number;
  end: number;
};

/**
 * The blocks of `text` under the given rules, in order: the block that starts first wins, the
 * earlier rule on a tie, and the next block is searched after it. Every block starts at a line
 * start, so a rule's match stays valid until the search passes its start.
 */
export const findBlocksMD = (text: string, rules: BlockMDRule[]): FoundBlockMD[] => {
  // `found` is unset until the rule is searched, and null once it has no block left.
  const searches: { rule: BlockMDRule; find: BlockFinder; found?: FoundBlock | null }[] = rules.map(
    (rule) => ({ rule, find: createBlockFinder(text, rule) })
  );
  const blocks: FoundBlockMD[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let best: FoundBlock | null = null;
    let bestRule: BlockMDRule | undefined;
    for (const search of searches) {
      if (search.found === undefined || (search.found !== null && search.found.index < cursor)) {
        search.found = search.find(cursor);
      }
      const candidate = search.found;
      if (candidate && (!best || candidate.index < best.index)) {
        best = candidate;
        bestRule = search.rule;
      }
    }
    if (!best || !bestRule) break;
    cursor = best.index + best.match[0].length;
    blocks.push({ rule: bestRule, match: best.match, start: best.index, end: cursor });
  }
  return blocks;
};

/**
 * Renders block Markdown with the given rules: each block `findBlocksMD` finds, and the text
 * between blocks rendered line by line with `parseInline`.
 */
export const parseBlockMDWithRules = (
  text: string,
  rules: BlockMDRule[],
  parseInline: InlineMDParser = plainText
): string => {
  let output = '';
  let cursor = 0;
  findBlocksMD(text, rules).forEach(({ rule, match, start, end }) => {
    if (start > cursor) output += renderText(text.slice(cursor, start), parseInline);
    output += rule.html(parseInline, match);
    cursor = end;
  });
  if (cursor < text.length) output += renderText(text.slice(cursor), parseInline);
  return output;
};

/**
 * Renders the Markdown of a chat message as HTML: fenced code, display math, headings, quotes
 * and lists, with `parseInline` for the text inside them and between them. The input is
 * HTML-escaped text. Text without Markdown comes back unchanged.
 */
export const parseBlockMD = (text: string, parseInline: InlineMDParser = plainText): string =>
  parseBlockMDWithRules(text, BLOCK_MD_RULES, parseInline);
