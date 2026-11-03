import { findDisplayLatexBlockMatch } from '../../math';
import type { InlineMDParser } from '../inline/type';
import type { BlockMDRule } from './type';

/** A match in the shape `String.prototype.match` returns: the whole match, then its parts. */
const toMatch = (parts: string[], index: number, input: string): RegExpMatchArray =>
  Object.assign(parts, { index, input }) as RegExpMatchArray;

/** Each line rendered inline, joined by line breaks. */
const renderLines = (lines: string[], parseInline: InlineMDParser): string =>
  lines.map((line) => parseInline(line)).join('<br/>');

type Line = { start: number; end: number };

const backtickRunLength = (text: string, from: number, to: number): number => {
  let end = from;
  while (end < to && text[end] === '`') end += 1;
  return end - from;
};

/** Whether `text` between `from` and `to` holds `length` backticks in a row. */
const hasBacktickRun = (text: string, from: number, to: number, length: number): boolean => {
  let run = 0;
  for (let index = from; index < to; index += 1) {
    run = text[index] === '`' ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
};

type FencedCodeBlock = { opener: Line; fence: string; info: string; closer: Line };
type Opener = Omit<FencedCodeBlock, 'closer'> & { closer?: Line };

/**
 * The fenced code blocks of `text`, by where they start: a line starting with three or more
 * backticks (the fence) and an info string that does not repeat the fence, up to the next line
 * that is exactly the same fence; a longer or shorter run of backticks inside stays code. A
 * closing line closes every open fence of its length, so no block takes another's closer and one
 * pass over the lines pairs them all. Blocks may overlap: a reader takes the first one that starts
 * where it reads. With `firstOnly` the pass stops once the first opener of `text` is closed; an
 * opener that never closes makes it read to the end.
 */
const findFencedCodeBlocks = (text: string, firstOnly: boolean): FencedCodeBlock[] => {
  const openers: Opener[] = [];
  const openByLength = new Map<number, Opener[]>();
  for (let start = 0; ; ) {
    const lineBreak = text.indexOf('\n', start);
    const line = { start, end: lineBreak < 0 ? text.length : lineBreak };
    const run = backtickRunLength(text, line.start, line.end);
    const closing = run >= 3 && run === line.end - line.start ? openByLength.get(run) : undefined;
    if (closing) {
      closing.forEach((opener) => {
        opener.closer = line;
      });
      openByLength.delete(run);
      if (firstOnly && openers[0].closer) break;
    }
    if (run >= 3 && lineBreak >= 0 && !hasBacktickRun(text, line.start + run, line.end, run)) {
      const opener: Opener = {
        opener: line,
        fence: text.slice(line.start, line.start + run),
        info: text.slice(line.start + run, line.end),
      };
      openers.push(opener);
      const sameLength = openByLength.get(run);
      if (sameLength) sameLength.push(opener);
      else openByLength.set(run, [opener]);
    }
    if (lineBreak < 0) break;
    start = lineBreak + 1;
  }
  return openers.filter((opener): opener is FencedCodeBlock => opener.closer !== undefined);
};

const toCodeBlockMatch = (text: string, block: FencedCodeBlock): RegExpMatchArray => {
  const { opener, fence, info, closer } = block;
  const end = closer.end < text.length ? closer.end + 1 : closer.end;
  return toMatch(
    [text.slice(opener.start, end), fence, info, text.slice(opener.end + 1, closer.start)],
    opener.start,
    text
  );
};

/** The first fenced code block of `text`; `findFencedCodeBlocks` describes the grammar. */
const matchCodeBlock = (text: string): RegExpMatchArray | null => {
  const [first] = findFencedCodeBlocks(text, true);
  return first ? toCodeBlockMatch(text, first) : null;
};

/** Pairs the fences of `text` once, then finds the first block that starts at or after `from`. */
const scanCodeBlocks = (text: string) => {
  const blocks = findFencedCodeBlocks(text, false);
  return (from: number): RegExpMatchArray | null => {
    // The pairing assumes lines of `text`; a search from inside a line reads that rest anew.
    if (from > 0 && text[from - 1] !== '\n') {
      const match = matchCodeBlock(text.slice(from));
      if (match?.index !== undefined) match.index += from;
      return match;
    }
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (blocks[middle].opener.start < from) low = middle + 1;
      else high = middle;
    }
    return low < blocks.length ? toCodeBlockMatch(text, blocks[low]) : null;
  };
};

/** A fenced code block; the first word of the info string is its language. */
export const CodeBlockRule: BlockMDRule = {
  match: matchCodeBlock,
  scan: scanCodeBlocks,
  html: (_parseInline, match) => {
    const [, fence, info, code] = match;
    const language = info.trim().split(/\s+/)[0];
    const languageClass = language ? ` class="language-${language}"` : '';
    return `<pre data-md="${fence}"><code${languageClass}>${code}</code></pre>`;
  },
};

/**
 * Display math between `$$` at the start of a line and `$$` at the end of one, found by
 * `findDisplayLatexBlockMatch`, sent as Matrix math with the LaTeX as written (already escaped).
 */
export const BlockMathRule: BlockMDRule = {
  match: (text) => {
    const found = findDisplayLatexBlockMatch(text);
    if (!found) return null;
    const end = text[found.end] === '\n' ? found.end + 1 : found.end;
    return toMatch([text.slice(found.start, end), found.latex], found.start, text);
  },
  html: (_parseInline, match) => {
    const latex = match[1];
    return `<div data-mx-maths="${latex}">${latex}</div>`;
  },
};

const HEADING_REG = /^(#{1,6})[ \t]+(\S[^\n]*)\n?/m;

/** The heading text without trailing whitespace or a closing run of hashes (`## Title ##`). */
const headingText = (line: string): string => {
  const trimmed = line.trimEnd();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === '#') end -= 1;
  if (end === trimmed.length || end === 0 || !/[ \t]/.test(trimmed[end - 1])) return trimmed;
  return trimmed.slice(0, end).trimEnd();
};

/** `# Heading` to `###### Heading`. */
export const HeadingRule: BlockMDRule = {
  match: (text) => text.match(HEADING_REG),
  html: (parseInline, match) => {
    const [, hashes, line] = match;
    const level = hashes.length;
    return `<h${level} data-md="${hashes}">${parseInline(headingText(line))}</h${level}>`;
  },
};

// Escaped text has `&gt;` for `>`, so a quote marker is either.
const BLOCKQUOTE_REG = /^(?:>|&gt;)[^\n]*(?:\n(?:>|&gt;)[^\n]*)*\n?/m;
const QUOTE_MARKER_REG = /^(?:>|&gt;) ?/;

/** Lines starting with `>`; each line of the quote ends with a line break. */
export const BlockQuoteRule: BlockMDRule = {
  match: (text) => text.match(BLOCKQUOTE_REG),
  html: (parseInline, match) => {
    const lines = match[0]
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => line.replace(QUOTE_MARKER_REG, ''));
    return `<blockquote data-md=">">${renderLines(lines, parseInline)}<br/></blockquote>`;
  },
};

// A list starts at an item indented by at most three spaces; nested items may be indented more.
const LIST_START_REG = /^ {0,3}(?:[*-]|\d{1,9}\.) /m;
const LIST_ITEM_REG = /^( *)([*-]|\d{1,9}\.) +(.*)$/;
const CONTINUATION_REG = /^[ \t]+\S/;

type ListItem = { lines: string[]; lists: List[] };
type List = { indent: number; marker: string; ordered: boolean; items: ListItem[] };

const parseListLines = (lines: string[]): List[] => {
  const roots: List[] = [];
  const open: List[] = [];
  lines.forEach((line) => {
    const item = line.match(LIST_ITEM_REG);
    if (!item) {
      const current = open[open.length - 1];
      current?.items[current.items.length - 1].lines.push(line.trim());
      return;
    }
    const [, spaces, marker, content] = item;
    const indent = spaces.length;
    const ordered = marker !== '*' && marker !== '-';
    while (open.length > 0 && open[open.length - 1].indent > indent) open.pop();
    let list = open[open.length - 1];
    if (
      list &&
      list.indent === indent &&
      (list.ordered !== ordered || (!ordered && list.marker !== marker))
    ) {
      open.pop();
      list = open[open.length - 1];
    }
    if (!list || list.indent !== indent) {
      const created: List = { indent, marker, ordered, items: [] };
      if (list) list.items[list.items.length - 1].lists.push(created);
      else roots.push(created);
      open.push(created);
      list = created;
    }
    list.items.push({ lines: [content], lists: [] });
  });
  return roots;
};

const renderList = (list: List, parseInline: InlineMDParser): string => {
  const items = list.items
    .map(
      (item) =>
        `<li>${renderLines(item.lines, parseInline)}${item.lists
          .map((nested) => renderList(nested, parseInline))
          .join('')}</li>`
    )
    .join('');
  if (!list.ordered) return `<ul data-md="${list.marker}">${items}</ul>`;
  const start = Number.parseInt(list.marker, 10);
  const startAttribute = start === 1 ? '' : ` start="${start}"`;
  return `<ol data-md="${list.marker}"${startAttribute}>${items}</ol>`;
};

/**
 * Bulleted (`*` or `-`) and numbered (`1.`) lists. More indented items nest; an indented line that
 * is not an item continues the item above it; a blank line or an unindented line ends the list.
 */
export const ListRule: BlockMDRule = {
  match: (text) => {
    const start = text.match(LIST_START_REG);
    if (!start || start.index === undefined) return null;
    let end = start.index;
    let first = true;
    while (end < text.length) {
      const lineEnd = text.indexOf('\n', end);
      const line = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
      if (!first && !LIST_ITEM_REG.test(line) && !CONTINUATION_REG.test(line)) break;
      first = false;
      end = lineEnd < 0 ? text.length : lineEnd + 1;
    }
    return toMatch([text.slice(start.index, end)], start.index, text);
  },
  html: (parseInline, match) =>
    parseListLines(match[0].replace(/\n$/, '').split('\n'))
      .map((list) => renderList(list, parseInline))
      .join(''),
};

/** Every block rule, in priority order for blocks that start at the same position. */
export const BLOCK_MD_RULES: BlockMDRule[] = [
  CodeBlockRule,
  BlockMathRule,
  HeadingRule,
  BlockQuoteRule,
  ListRule,
];
