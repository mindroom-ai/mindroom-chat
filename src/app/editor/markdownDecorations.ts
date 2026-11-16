import { Element, Text, type Descendant, type NodeEntry, type Path, type Range } from 'slate';
import { findInlineMDSpans } from '../rich-text/markdown/inline/parser';
import { INLINE_MD_RULES, inlineMDRulesWithLinkSchemes } from '../rich-text/markdown/inline/rules';
import type {
  InlineMDRule,
  InlineMDSpan,
  InlineMDSpanKind,
} from '../rich-text/markdown/inline/type';
import { sanitizeText } from '../rich-text/sanitize';
import { nodeToCustomHtml, textMarkTags } from './output';
import { BlockType } from './types';
import type { InlineContent } from './slate';

// Typed Markdown shown styled in place, as Discord and Slate's markdown-preview example do: the
// text keeps every character, Markdown syntax included, and decorations only change how it looks.
// So selecting, copying, undo, drafts and sending see the raw Markdown, as before. Each line is
// read the way sending reads it: its HTML (text escaped, marks as tags, mentions and other atoms
// as their HTML) goes through the inline parser of the sent message, and the spans the parser
// reports map back to the line's text, so the styling shows what the message will send.

/** What a decoration sets on the text it covers: the marks `RenderLeaf` draws, and Markdown syntax. */
export type MarkdownLeaf = {
  bold?: boolean;
  italic?: boolean;
  strikeThrough?: boolean;
  spoiler?: boolean;
  code?: boolean;
  /** Markdown syntax, such as `**`, a backslash or a link's `](url)`; drawn dimmed. */
  marker?: true;
  /** The label of a Markdown link. */
  linkLabel?: true;
};

export type MarkdownRange = Range & MarkdownLeaf;

const MARK_OF_KIND: Partial<Record<InlineMDSpanKind, keyof MarkdownLeaf>> = {
  bold: 'bold',
  italic: 'italic',
  strikethrough: 'strikeThrough',
  spoiler: 'spoiler',
};

/** Blocks whose line the sent message reads inline Markdown in. */
const LINE_BLOCKS: ReadonlySet<string> = new Set([
  BlockType.Paragraph,
  BlockType.Heading,
  BlockType.QuoteLine,
  BlockType.ListItem,
]);

/** Blocks that hold line blocks; a code block holds code, which is never read as Markdown. */
const CONTAINER_BLOCKS: ReadonlySet<string> = new Set([
  BlockType.BlockQuote,
  BlockType.OrderedList,
  BlockType.UnorderedList,
]);

// `/plain` and `/html` at the start send the text without reading Markdown in it, as
// `composeTextMessage` (`composer/`) reads them: plain text at the start of the first paragraph.
const RAW_COMMAND = /^\/(?:plain|html)(?:\s+|$)/;

/** Whether the document starts with a command that sends it without reading Markdown. */
const sendsWithoutMarkdown = (document: Descendant[]): boolean => {
  const first = document[0];
  if (!first || !Element.isElement(first) || first.type !== BlockType.Paragraph) return false;
  const run = first.children[0];
  return !!run && Text.isText(run) && RAW_COMMAND.test(run.text);
};

const ESCAPED = /[&<>"']/;

/** Sending puts no mark tags around empty text. */
const NO_TAGS = { open: '', close: '' };

/**
 * A line's HTML as sending builds it, and where its text sits in it: for each place between two
 * characters of a text child (and at either end), its offset in `html`, the child and the offset
 * in that child, in order. Atoms add their HTML and no places, so a range never ends inside one.
 */
type LineSource = { html: string; at: number[]; child: number[]; offset: number[] };

const readLine = (children: InlineContent[]): LineSource => {
  const source: LineSource = { html: '', at: [], child: [], offset: [] };
  children.forEach((node, index) => {
    if (!Text.isText(node)) {
      source.html += nodeToCustomHtml(node, { allowTextFormatting: true });
      return;
    }
    const { text } = node;
    const { open, close } = text === '' ? NO_TAGS : textMarkTags(node);
    source.html += open;
    for (let offset = 0; offset <= text.length; offset += 1) {
      source.at.push(source.html.length);
      source.child.push(index);
      source.offset.push(offset);
      const character = text.charAt(offset);
      source.html += ESCAPED.test(character) ? sanitizeText(character) : character;
    }
    source.html += close;
  });
  return source;
};

type Place = { child: number; offset: number };

/**
 * The place of a range edge at `htmlOffset`: the last place at or before it for a start, the
 * first at or after it for an end, so a range covers any HTML it starts or ends inside.
 */
const placeAt = (source: LineSource, htmlOffset: number, edge: 'start' | 'end'): Place | null => {
  const { at } = source;
  // The first place after `htmlOffset` (start) or at or after it (end), by binary search.
  let low = 0;
  let high = at.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const value = at[middle] ?? 0;
    if (edge === 'start' ? value <= htmlOffset : value < htmlOffset) low = middle + 1;
    else high = middle;
  }
  const index = edge === 'start' ? low - 1 : low;
  const child = source.child[index];
  const offset = source.offset[index];
  return child === undefined || offset === undefined ? null : { child, offset };
};

const isBefore = (a: Place, b: Place): boolean =>
  a.child < b.child || (a.child === b.child && a.offset < b.offset);

const toRange = (path: Path, from: Place, to: Place, leaf: MarkdownLeaf): MarkdownRange => ({
  anchor: { path: [...path, from.child], offset: from.offset },
  focus: { path: [...path, to.child], offset: to.offset },
  ...leaf,
});

/** The ranges of one span the parser found, in a line at `path`. */
const spanRanges = (
  source: LineSource,
  path: Path,
  span: InlineMDSpan,
  ranges: MarkdownRange[]
): void => {
  const add = (start: number, end: number, leaf: MarkdownLeaf) => {
    const from = placeAt(source, start, 'start');
    const to = placeAt(source, end, 'end');
    if (from && to && isBefore(from, to)) ranges.push(toRange(path, from, to, leaf));
  };
  const { kind, start, end, open, close } = span;
  const mark = MARK_OF_KIND[kind];
  if (kind === 'code') add(start + open, end - close, { code: true });
  else if (kind === 'link') add(start + open, end - close, { linkLabel: true });
  else if (mark) add(start + open, end - close, { [mark]: true });
  add(start, start + open, { marker: true });
  add(end - close, end, { marker: true });
};

const HEADING_CUE = /^#{1,6}[ \t]+(?=\S)/;
const QUOTE_CUE = /^> ?/;
const LIST_CUE = /^ {0,3}(?:[*-]|\d{1,9}\.) +/;

/**
 * The block Markdown a line typed in a paragraph starts with, as sending reads it: the length of
 * its marker (`## `, `> `, `- `, `1. `) and whether it makes the line a heading. Each line is
 * read on its own, so a line inside a fenced code block still shows its cue.
 */
export const findBlockCue = (line: string): { marker: number; heading: boolean } | undefined => {
  const heading = HEADING_CUE.exec(line);
  if (heading) return { marker: heading[0].length, heading: true };
  const other = QUOTE_CUE.exec(line) ?? LIST_CUE.exec(line);
  return other ? { marker: other[0].length, heading: false } : undefined;
};

/** The block cue ranges of a paragraph at `path`: its marker dimmed, a heading's line bold. */
const blockCueRanges = (children: InlineContent[], path: Path, ranges: MarkdownRange[]): void => {
  const first = children[0];
  const cue = first && Text.isText(first) ? findBlockCue(first.text) : undefined;
  if (!cue) return;
  const start = { child: 0, offset: 0 };
  if (cue.heading) {
    const lastIndex = children.length - 1;
    const last = children[lastIndex];
    const end = { child: lastIndex, offset: last && Text.isText(last) ? last.text.length : 0 };
    ranges.push(toRange(path, start, end, { bold: true }));
  }
  ranges.push(toRange(path, start, { child: 0, offset: cue.marker }, { marker: true }));
};

/** The ranges that style the line block at `path`. */
const lineRanges = (
  children: InlineContent[],
  path: Path,
  paragraph: boolean,
  rules: InlineMDRule[]
): MarkdownRange[] => {
  const ranges: MarkdownRange[] = [];
  if (paragraph) blockCueRanges(children, path, ranges);
  const source = readLine(children);
  findInlineMDSpans(source.html, rules).forEach((span) => spanRanges(source, path, span, ranges));
  return ranges;
};

/**
 * A Slate `decorate` that shows the composer's Markdown styled while its syntax stays visible,
 * dimmed. It answers for the whole document at the editor's own entry, as `/plain` in the first
 * line changes every line, and nothing for other entries. Each line's ranges are kept until the
 * line changes or moves, so a keystroke reads only the line it changed. `linkSchemes` are the
 * deployment's extra link schemes, as sending takes them.
 */
export const createMarkdownDecorate = (
  linkSchemes?: readonly string[]
): ((entry: NodeEntry) => MarkdownRange[]) => {
  const rules =
    linkSchemes && linkSchemes.length > 0
      ? inlineMDRulesWithLinkSchemes(linkSchemes)
      : INLINE_MD_RULES;
  const cache = new WeakMap<Element, { path: string; ranges: MarkdownRange[] }>();
  return ([node, path]) => {
    if (path.length > 0 || !('children' in node)) return [];
    const document = node.children;
    if (sendsWithoutMarkdown(document)) return [];
    const ranges: MarkdownRange[] = [];
    const visit = (nodes: Descendant[], parent: Path) => {
      nodes.forEach((child, index) => {
        if (!Element.isElement(child)) return;
        const childPath = [...parent, index];
        if (CONTAINER_BLOCKS.has(child.type)) {
          visit(child.children, childPath);
          return;
        }
        if (!LINE_BLOCKS.has(child.type)) return;
        const key = childPath.join(',');
        let entry = cache.get(child);
        if (entry?.path !== key) {
          const paragraph = child.type === BlockType.Paragraph;
          const children = child.children as InlineContent[];
          entry = { path: key, ranges: lineRanges(children, childPath, paragraph, rules) };
          cache.set(child, entry);
        }
        entry.ranges.forEach((range) => ranges.push(range));
      });
    };
    visit(document, []);
    return ranges;
  };
};
