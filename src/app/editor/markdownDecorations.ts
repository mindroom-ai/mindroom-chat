import { Editor, Element, type Descendant, type NodeEntry, type Path, type Range } from 'slate';
import { findBlocksMD } from '../rich-text/markdown/block/parser';
import {
  LITERAL_BLOCK_MD_RULES,
  SENT_BLOCK_MD_RULES,
  TableRule,
} from '../rich-text/markdown/block/rules';
import { findInlineMDSpans } from '../rich-text/markdown/inline/parser';
import { INLINE_MD_RULES, inlineMDRulesWithLinkSchemes } from '../rich-text/markdown/inline/rules';
import type { BlockMDRule } from '../rich-text/markdown/block/type';
import type {
  InlineMDRule,
  InlineMDSpan,
  InlineMDSpanKind,
} from '../rich-text/markdown/inline/type';
import { sanitizeText } from '../rich-text/sanitize';
import { findMessageCommand, sendsAsTyped } from './messageCommand';
import { linkTags, nodeToCustomHtml, textMarkTags } from './output';
import { BlockType } from './types';

// Typed Markdown shown styled in place, as Discord and Slate's markdown-preview example do: the
// text keeps every character, Markdown syntax included, and decorations only change how it looks.
// So selecting, copying, undo, drafts and sending see the raw Markdown, as before. Each line is
// read the way sending reads it: its HTML (text escaped, marks as tags, mentions and other atoms
// as their HTML) goes through the inline parser of the sent message, and the spans the parser
// reports map back to the line's text, so the styling shows what the message will send. Lines
// sending reads as code, math or a table, by its own block parser, stay unstyled.

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

/** Blocks whose line the sent message reads inline Markdown in, besides paragraphs. */
const LINE_BLOCKS: ReadonlySet<string> = new Set([
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

const ESCAPED = /[&<>"']/;

/** Sending puts no mark tags around empty text. */
const NO_TAGS = { open: '', close: '' };

/**
 * A line's HTML as sending builds it, and where its text sits in it: for each place between two
 * characters of a text node (and at either end), its offset in `html` and its point, by the path
 * from the line and the offset in that text, in document order. Atoms (void elements) add their
 * HTML and no places, so a range never ends inside one; a link adds its tags around its text.
 */
type LineSource = { html: string; at: number[]; places: { path: Path; offset: number }[] };

const readLine = (editor: Editor, children: Descendant[], skip: number): LineSource => {
  const source: LineSource = { html: '', at: [], places: [] };
  const read = (nodes: Descendant[], parent: Path) => {
    nodes.forEach((node, index) => {
      const path = [...parent, index];
      if (Element.isElement(node)) {
        if (editor.isVoid(node)) {
          source.html += nodeToCustomHtml(node, { allowTextFormatting: true });
          return;
        }
        const { open, close } = node.type === BlockType.Link ? linkTags(node) : NO_TAGS;
        source.html += open;
        read(node.children, path);
        source.html += close;
        return;
      }
      // Sending drops a leading command, the first `skip` characters of the line's first text.
      const from = path.length === 1 && path[0] === 0 ? skip : 0;
      const text = node.text.slice(from);
      const { open, close } = text === '' ? NO_TAGS : textMarkTags(node);
      source.html += open;
      for (let offset = 0; offset <= text.length; offset += 1) {
        source.at.push(source.html.length);
        source.places.push({ path, offset: from + offset });
        const character = text.charAt(offset);
        source.html += ESCAPED.test(character) ? sanitizeText(character) : character;
      }
      source.html += close;
    });
  };
  read(children, []);
  return source;
};

/**
 * The index of the place of a range edge at `htmlOffset`: the last place at or before it for a
 * start, the first at or after it for an end, so a range covers any HTML it starts or ends inside.
 */
const placeAt = (source: LineSource, htmlOffset: number, edge: 'start' | 'end'): number => {
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
  return edge === 'start' ? low - 1 : low;
};

/** The ranges of one span the parser found, in a line at `path`. */
const spanRanges = (
  source: LineSource,
  path: Path,
  span: InlineMDSpan,
  ranges: MarkdownRange[]
): void => {
  const add = (start: number, end: number, leaf: MarkdownLeaf) => {
    const fromIndex = placeAt(source, start, 'start');
    const toIndex = placeAt(source, end, 'end');
    const from = source.places[fromIndex];
    const to = source.places[toIndex];
    if (from && to && fromIndex < toIndex) {
      ranges.push({
        anchor: { path: [...path, ...from.path], offset: from.offset },
        focus: { path: [...path, ...to.path], offset: to.offset },
        ...leaf,
      });
    }
  };
  const { kind, start, end, open, close } = span;
  const mark = MARK_OF_KIND[kind];
  if (kind === 'code') add(start + open, end - close, { code: true });
  else if (kind === 'link') add(start + open, end - close, { linkLabel: true });
  else if (mark) add(start + open, end - close, { [mark]: true });
  add(start, start + open, { marker: true });
  add(end - close, end, { marker: true });
};

/**
 * The most ranges a line is styled with. Slate splits a text by each range in turn, so applying
 * ranges costs about their count squared: 200 take about 2 ms, 1,500 about 60 ms (a line of
 * `**a** ` 500 times). A line with more is shown plain, as before this styling.
 */
export const MAX_LINE_RANGES = 200;

/** The ranges that style the line read in `source`, at `path`. */
const lineRanges = (source: LineSource, path: Path, rules: InlineMDRule[]): MarkdownRange[] => {
  const ranges: MarkdownRange[] = [];
  findInlineMDSpans(source.html, rules).forEach((span) => spanRanges(source, path, span, ranges));
  return ranges.length > MAX_LINE_RANGES ? [] : ranges;
};

/**
 * The blocks whose lines are not sent as lines of inline Markdown: code and math, sent as
 * written, and tables, whose cells are read one by one.
 */
const UNSTYLED_BLOCK_MD_RULES: ReadonlySet<BlockMDRule> = new Set([
  ...LITERAL_BLOCK_MD_RULES,
  TableRule,
]);

/**
 * Which of a run of paragraph lines sending reads in a code, math or table block, which the line
 * styling cannot show: it joins the run into one Markdown text and reads its blocks, as
 * `toMatrixCustomHTML` does, so a fence or a `$$` line changes the lines after it as it changes
 * the sent message.
 */
const unstyledLines = (lines: string[]): Set<number> => {
  const unstyled = new Set<number>();
  const blocks = findBlocksMD(lines.join('\n'), SENT_BLOCK_MD_RULES);
  let line = 0;
  let lineStart = 0;
  blocks.forEach((block) => {
    if (!UNSTYLED_BLOCK_MD_RULES.has(block.rule)) return;
    while (line < lines.length && lineStart < block.end) {
      if (lineStart >= block.start) unstyled.add(line);
      lineStart += (lines[line] ?? '').length + 1;
      line += 1;
    }
  });
  return unstyled;
};

type MarkdownDecorateOptions = {
  /** The deployment's extra link schemes, as sending takes them. */
  linkSchemes?: readonly string[];
  /**
   * Whether a message command at the start (`/me`, `/plain`, ...) is taken off before sending,
   * as the room composer does; `/plain` and `/html` then send without Markdown. The message edit
   * box reads no commands.
   */
  commands?: boolean;
};

/**
 * A Slate `decorate` that shows the composer's Markdown styled while its syntax stays visible,
 * dimmed. It answers for the whole document at the editor's own entry, as `/plain` in the first
 * line or a code fence changes the lines after it, and nothing for other entries. Each line's
 * ranges are kept until the line changes or moves, so a keystroke reads only the line it changed;
 * which lines are code is read anew each time, as a neighbour can change it.
 */
export const createMarkdownDecorate = (
  options: MarkdownDecorateOptions = {}
): ((entry: NodeEntry) => MarkdownRange[]) => {
  const { linkSchemes, commands = false } = options;
  const rules =
    linkSchemes && linkSchemes.length > 0
      ? inlineMDRulesWithLinkSchemes(linkSchemes)
      : INLINE_MD_RULES;
  type Line = { path: string; html: string; ranges: MarkdownRange[] };
  const cache = new WeakMap<Element, Line>();
  return ([node, path]) => {
    if (path.length > 0 || !Editor.isEditor(node)) return [];
    const editor = node;
    const document = editor.children;
    const command = commands ? findMessageCommand(document) : undefined;
    if (command && sendsAsTyped(command.command)) return [];
    const lineOf = (element: Element, elementPath: Path): Line => {
      // The command is part of the first line's text only, and sending reads that line without it.
      const skip = command && elementPath.length === 1 && elementPath[0] === 0 ? command.length : 0;
      const key = `${elementPath.join(',')}:${skip}`;
      let line = cache.get(element);
      if (line?.path !== key) {
        const source = readLine(editor, element.children, skip);
        line = { path: key, html: source.html, ranges: lineRanges(source, elementPath, rules) };
        cache.set(element, line);
      }
      return line;
    };
    const ranges: MarkdownRange[] = [];
    const push = (line: Line) => line.ranges.forEach((range) => ranges.push(range));
    // Sending reads each run of top-level paragraphs as one Markdown text.
    let run: Line[] = [];
    const flushRun = () => {
      if (run.length === 0) return;
      const unstyled = unstyledLines(run.map((line) => line.html));
      run.forEach((line, index) => {
        if (!unstyled.has(index)) push(line);
      });
      run = [];
    };
    const visit = (child: Descendant, childPath: Path) => {
      if (!Element.isElement(child)) return;
      if (CONTAINER_BLOCKS.has(child.type)) {
        child.children.forEach((grandchild, index) => visit(grandchild, [...childPath, index]));
      } else if (LINE_BLOCKS.has(child.type)) push(lineOf(child, childPath));
    };
    document.forEach((child, index) => {
      if (Element.isElement(child) && child.type === BlockType.Paragraph) {
        run.push(lineOf(child, [index]));
        return;
      }
      flushRun();
      visit(child, [index]);
    });
    flushRun();
    return ranges;
  };
};
