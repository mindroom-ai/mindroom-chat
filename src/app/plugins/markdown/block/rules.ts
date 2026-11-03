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

type Opener = { line: Line; fence: string; info: string; closed: boolean };

/**
 * Finds the first fenced code block: a line starting with three or more backticks (the fence)
 * and an info string that does not repeat the fence, up to the next line that is exactly the
 * same fence; a longer or shorter run of backticks inside stays code. One pass over the lines,
 * which stops once the earliest opener still open is closed: a closing line closes every open
 * fence of its length, and an earlier opener that never closes only costs reading to the end.
 */
const matchCodeBlock = (text: string): RegExpMatchArray | null => {
  const opened: Opener[] = [];
  const openByLength = new Map<number, Opener[]>();
  let firstOpen = 0;
  let block: { opener: Opener; closer: Line } | undefined;
  const earliestOpen = (): Opener | undefined => {
    while (firstOpen < opened.length && opened[firstOpen].closed) firstOpen += 1;
    return opened[firstOpen];
  };

  for (let start = 0; ; ) {
    const lineBreak = text.indexOf('\n', start);
    const line = { start, end: lineBreak < 0 ? text.length : lineBreak };
    const run = backtickRunLength(text, line.start, line.end);

    const closing = run >= 3 && run === line.end - line.start ? openByLength.get(run) : undefined;
    if (closing) {
      closing.forEach((opener) => {
        opener.closed = true;
      });
      openByLength.delete(run);
      if (!block || closing[0].line.start < block.opener.line.start) {
        block = { opener: closing[0], closer: line };
      }
    }
    if (block) {
      const open = earliestOpen();
      if (!open || open.line.start > block.opener.line.start) break;
    }

    if (run >= 3 && lineBreak >= 0) {
      const fence = text.slice(line.start, line.start + run);
      const info = text.slice(line.start + run, line.end);
      if (!info.includes(fence)) {
        const opener: Opener = { line, fence, info, closed: false };
        opened.push(opener);
        const sameLength = openByLength.get(run);
        if (sameLength) sameLength.push(opener);
        else openByLength.set(run, [opener]);
      }
    }
    if (lineBreak < 0) break;
    start = lineBreak + 1;
  }

  if (!block) return null;
  const { opener, closer } = block;
  const end = closer.end < text.length ? closer.end + 1 : closer.end;
  return toMatch(
    [
      text.slice(opener.line.start, end),
      opener.fence,
      opener.info,
      text.slice(opener.line.end + 1, closer.start),
    ],
    opener.line.start,
    text
  );
};

/** A fenced code block; the first word of the info string is its language. */
export const CodeBlockRule: BlockMDRule = {
  match: matchCodeBlock,
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
