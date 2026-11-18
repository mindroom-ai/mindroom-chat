import { htmlToDOM, type HTMLReactParserOptions } from 'html-react-parser';
import { isText, type ChildNode } from 'domhandler';
import { MINDROOM_TOOL_REF_HTML_REG_G, MINDROOM_TOOL_REF_ICON } from '../html/blocks';
import {
  sanitizeCustomHtml,
  sanitizeText,
  type SanitizeCustomHtmlOptions,
} from '../../rich-text/sanitize';
import { isDomElementNode } from './toolRefDom';
import { parseRenderedHtml, readRenderedToolCalls } from '../html/HtmlBlocks';

export type FinishedWorkSplit = {
  /**
   * The work, sanitized: through the top-level node of the last call it draws, alone or in the
   * answer.
   */
  head: string;
  /** The answer after it, sanitized. */
  tail: string;
};

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

// HTML parsing drops a newline right after these opening tags, so a serializer writes one more
// when the element's text starts with a newline (as the HTML spec's serialization does).
const LEADING_NEWLINE_ELEMENTS = new Set(['pre', 'textarea', 'listing']);

// The browser build parses with DOMParser, which reports no source positions, so the halves are
// written out again from the nodes. Only text nodes are text: comments and directives drop.
export const serializeHtmlNode = (node: ChildNode): string => {
  if (isText(node)) return sanitizeText(node.data);
  if (!isDomElementNode(node)) return '';
  const attributes = Object.entries(node.attribs)
    .map(([name, value]) => ` ${name}="${sanitizeText(value)}"`)
    .join('');
  const open = `<${node.name}${attributes}>`;
  if (VOID_ELEMENTS.has(node.name)) return open;
  const [first] = node.children;
  const leadingNewline =
    LEADING_NEWLINE_ELEMENTS.has(node.name) && first && isText(first) && first.data.startsWith('\n')
      ? '\n'
      : '';
  return `${open}${leadingNewline}${node.children.map(serializeHtmlNode).join('')}</${node.name}>`;
};

const MEDIA_ELEMENTS = new Set(['img', 'video', 'audio']);
// The pending mark of a tool call and characters that show nothing.
const INVISIBLE_TEXT = /[\s⏳\u200B-\u200D\u2060\uFEFF]|\uFE0F/gu;

const hasVisibleContent = (nodes: ChildNode[]): boolean =>
  nodes.some((node) => {
    if (isText(node)) return node.data.replace(INVISIBLE_TEXT, '') !== '';
    if (!isDomElementNode(node)) return false;
    return MEDIA_ELEMENTS.has(node.name) || hasVisibleContent(node.children);
  });

/** Whether the sanitized HTML shows anything. */
const rendersVisibleContent = (html: string): boolean =>
  hasVisibleContent(htmlToDOM(html) as ChildNode[]);

// A marker the renderer draws from the start of a paragraph, after line breaks or the markers
// before it (`takeLeadingToolRefs`), and the breaks that follow the last one.
const LEADING_TOOL_REF = new RegExp(`(?:\\s|<br>)*(?:${MINDROOM_TOOL_REF_HTML_REG_G.source})`, 'y');
const LEADING_BREAKS = /^(?:\s|<br>)*/;

/**
 * The top-level node of the last call, cut where its calls end: the work and the answer that
 * starts in it (empty when nothing shows after its calls); undefined when it cannot be cut there.
 */
const cutAfterCalls = (node: ChildNode): [string, string] | undefined => {
  const html = serializeHtmlNode(node);
  if (!isDomElementNode(node) || node.name !== 'p') {
    // Only a paragraph's inline content cuts cleanly in two. Text after the calls of a list item
    // or a wrapper would hide in the work, so such a reply does not fold.
    return rendersVisibleContent(html.replace(MINDROOM_TOOL_REF_HTML_REG_G, ''))
      ? undefined
      : [html, ''];
  }
  const inner = node.children.map(serializeHtmlNode).join('');
  let end = 0;
  LEADING_TOOL_REF.lastIndex = 0;
  while (LEADING_TOOL_REF.exec(inner)) end = LEADING_TOOL_REF.lastIndex;
  const rest = inner.slice(end).replace(LEADING_BREAKS, '');
  if (!rendersVisibleContent(rest)) return [html, ''];
  if (end === 0) return undefined;
  const open = html.slice(0, html.indexOf('>') + 1);
  return [`${open}${inner.slice(0, end)}</p>`, `${open}${rest}</p>`];
};

/**
 * Splits a finished agent reply's HTML, sanitized with the options `RenderBody` renders it with
 * (`useBodySanitizeOptions`), after the last call the renderer draws with these base parser
 * options (see `readRenderedToolCalls`): after its top-level node, or inside the paragraph whose
 * text after the call starts the answer. Returns undefined when it draws no call, nothing visible
 * follows the last one, or the answer starts inside a node that does not cut cleanly.
 */
export const splitFinishedWork = (
  html: string,
  baseOpts: HTMLReactParserOptions,
  sanitizeOptions: SanitizeCustomHtmlOptions
): FinishedWorkSplit | undefined => {
  if (!html.includes(MINDROOM_TOOL_REF_ICON)) return undefined;
  const sanitized = sanitizeCustomHtml(html, sanitizeOptions);
  const { lastNode } = readRenderedToolCalls(sanitized, baseOpts);
  if (lastNode < 0) return undefined;
  // Cut from a parse of its own: finding the calls draws them, which changes the nodes it read.
  const nodes = parseRenderedHtml(sanitized, baseOpts);
  const serialize = (from: number, to?: number) =>
    nodes.slice(from, to).map(serializeHtmlNode).join('');
  // The answer renders on its own, where a marker the whole body shows as text (one naming a call
  // drawn before it) draws as a call: the work takes it in.
  let end = lastNode + 1;
  for (;;) {
    const tail = serialize(end);
    const drawn = tail.includes(MINDROOM_TOOL_REF_ICON)
      ? readRenderedToolCalls(tail, baseOpts).lastNode
      : -1;
    if (drawn < 0) {
      const last = nodes[end - 1];
      const cut = last && cutAfterCalls(last);
      if (!cut) return undefined;
      const answer = `${cut[1]}${tail}`;
      return rendersVisibleContent(answer)
        ? { head: `${serialize(0, end - 1)}${cut[0]}`, tail: answer }
        : undefined;
    }
    end += drawn + 1;
  }
};

// A line of text wraps into another row about every 100 characters.
const ROW_CHARS = 100;
// Work of fewer rows shows inline: folding it would hide little.
const MIN_FOLDED_WORK_ROWS = 8;
// Work of this many rows folds however long the answer is.
const ALWAYS_FOLDED_WORK_ROWS = 13;
// Shorter work folds while it is at least a quarter of the reply: its answer at most 3 times it.
const MAX_ANSWER_ROWS_PER_WORK_ROW = 3;

// A tool marker's line, in the plain body (`🔧 \`shell\` [1]`) or in the HTML's text.
const TOOL_MARKER_LINE = /^🔧 .+ \[\d+\](?: ⏳)?$/u;
// Elements whose content starts and ends a line.
const LINE_ELEMENTS = new Set(
  'p div li pre blockquote h1 h2 h3 h4 h5 h6 ul ol table tr br hr details summary'.split(' ')
);

/** The lines of text the nodes show, blank ones included. */
const readLines = (nodes: ChildNode[], lines: string[] = ['']): string[] => {
  nodes.forEach((node) => {
    if (isText(node)) {
      const [first = '', ...more] = node.data.split('\n');
      lines.push(`${lines.pop() ?? ''}${first}`, ...more);
    } else if (isDomElementNode(node)) {
      const line = LINE_ELEMENTS.has(node.name);
      if (line) lines.push('');
      readLines(node.children, lines);
      if (line) lines.push('');
    }
  });
  return lines;
};

/**
 * The rows the lines render as: each line of text as many as it wraps into, and each run of tool
 * markers one, the row of its summary, or none while the calls are hidden behind the cog.
 */
const countRows = (lines: string[], toolCallsShown: boolean): number => {
  let rows = 0;
  let inRun = false;
  lines.forEach((untrimmed) => {
    const line = untrimmed.trim();
    if (line === '') return;
    const marker = TOOL_MARKER_LINE.test(line);
    if (!marker) rows += Math.max(1, Math.ceil(line.length / ROW_CHARS));
    else if (!inRun && toolCallsShown) rows += 1;
    inRun = marker;
  });
  return rows;
};

const foldsWork = (workRows: number, answerRows: number): boolean =>
  workRows >= MIN_FOLDED_WORK_ROWS &&
  (workRows >= ALWAYS_FOLDED_WORK_ROWS || answerRows <= MAX_ANSWER_ROWS_PER_WORK_ROW * workRows);

/**
 * The split of a finished agent reply (see `splitFinishedWork`) when its work is worth folding,
 * counted in the rows it renders as: at least 8, and either 13 or more or at least a quarter of
 * the reply. The answer stays in view, so only the work's rows say whether folding hides much.
 * `toolCallsShown`: the reply lists its calls, or folds them all into the cog. `seamRows`: the
 * work's rows outside its body, the reasoning line (or the cog's own row) and each seam.
 */
export const foldFinishedWork = (
  body: string,
  html: string,
  baseOpts: HTMLReactParserOptions,
  sanitizeOptions: SanitizeCustomHtmlOptions,
  toolCallsShown: boolean,
  seamRows: number
): FinishedWorkSplit | undefined => {
  // The whole plain body bounds the work's rows, so most replies skip the split.
  if (!foldsWork(countRows(body.split('\n'), toolCallsShown) + seamRows, 0)) return undefined;
  const split = splitFinishedWork(html, baseOpts, sanitizeOptions);
  const rows = (part: string) =>
    countRows(readLines(htmlToDOM(part) as ChildNode[]), toolCallsShown);
  return split && foldsWork(rows(split.head) + seamRows, rows(split.tail)) ? split : undefined;
};
