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
const rendersVisibleContent = (html: string): boolean => hasVisibleContent(htmlToDOM(html));

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
    // What follows its last marker (`split` starts from the first character, whatever the shared
    // pattern's `lastIndex`).
    const after = html.split(MINDROOM_TOOL_REF_HTML_REG_G).at(-1) ?? html;
    return rendersVisibleContent(after) ? undefined : [html, ''];
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
 * follows the last one, the answer starts inside a node that does not cut cleanly, or the work
 * shows nothing but its calls: its reasoning, which is not in the HTML, already shows folded and
 * each call is one row, so only text or media before the last call is worth folding.
 */
export const splitFinishedWork = (
  html: string,
  baseOpts: HTMLReactParserOptions,
  sanitizeOptions: SanitizeCustomHtmlOptions
): FinishedWorkSplit | undefined => {
  if (!html.includes(MINDROOM_TOOL_REF_ICON)) return undefined;
  const sanitized = sanitizeCustomHtml(html, sanitizeOptions);
  const { indexes, lastNode } = readRenderedToolCalls(sanitized, baseOpts);
  if (lastNode < 0) return undefined;
  // The work without the calls the reply draws: a marker of a call it never draws (in a quote, a
  // list or a heading) shows as text. A repeated marker of a drawn call is drawn with it or hidden,
  // so it goes too. (`replace` starts from the first character, whatever the shared pattern's
  // `lastIndex`.)
  const drawn = new Set(indexes);
  const withoutDrawnCalls = (work: string) =>
    work.replace(MINDROOM_TOOL_REF_HTML_REG_G, (marker: string, _name: string, index: string) =>
      drawn.has(Number(index)) ? '' : marker
    );
  // Cut from a parse of its own: finding the calls draws them, which changes the nodes it read.
  const nodes = parseRenderedHtml(sanitized, baseOpts);
  const serialize = (from: number, to?: number) =>
    nodes.slice(from, to).map(serializeHtmlNode).join('');
  // The answer renders on its own, where a marker the whole body shows as text (one naming a call
  // drawn before it) draws as a call: the work takes it in.
  let end = lastNode + 1;
  for (;;) {
    const tail = serialize(end);
    const drawnInTail = tail.includes(MINDROOM_TOOL_REF_ICON)
      ? readRenderedToolCalls(tail, baseOpts).lastNode
      : -1;
    if (drawnInTail < 0) {
      const last = nodes[end - 1];
      const cut = last && cutAfterCalls(last);
      if (!cut) return undefined;
      const head = `${serialize(0, end - 1)}${cut[0]}`;
      const answer = `${cut[1]}${tail}`;
      return rendersVisibleContent(withoutDrawnCalls(head)) && rendersVisibleContent(answer)
        ? { head, tail: answer }
        : undefined;
    }
    end += drawnInTail + 1;
  }
};
