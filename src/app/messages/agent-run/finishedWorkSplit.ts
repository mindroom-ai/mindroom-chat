import { htmlToDOM } from 'html-react-parser';
import { isText, type ChildNode } from 'domhandler';
import { MINDROOM_TOOL_REF_ICON, parseToolRefText } from '../html/blocks';
import { sanitizeCustomHtml, sanitizeText } from '../../rich-text/sanitize';
import {
  extractTextFromChildren,
  isDomElementNode,
  parseToolBlockMarker,
  takeLeadingToolRefs,
} from './toolRefDom';

export type FinishedWorkSplit = {
  /** The work: everything up to and including the block of the last tool marker. */
  head: string;
  /** What follows the last tool marker: the reply's answer. */
  tail: string;
};

// The timeline's long-message length (FORCE_COLLAPSED_OVERFLOW_BODY_LENGTH in
// timeline/threadCollapsibleMessages.ts, a layer messages may not import).
const LONG_AGENT_REPLY_LENGTH = 1200;
// A tool marker renders as a full row, however short its line.
const TOOL_MARKER_LINE_LENGTH = 80;

/**
 * Whether a finished agent reply is long enough to fold its work: its plain body is at least
 * 1200 characters, each tool marker line counted as 80. A length, not a measured height, so every
 * device and layout agrees and nothing waits for the reply to lay out.
 */
export const isLongAgentReply = (body: string): boolean =>
  body
    .split('\n')
    .reduce(
      (length, line) =>
        length + (parseToolRefText(line) ? TOOL_MARKER_LINE_LENGTH - line.length : 0),
      body.length
    ) >= LONG_AGENT_REPLY_LENGTH;

/** Whether the renderer shows this top-level node as a tool block, as `getRenderedToolRefs` reads it. */
const startsWithToolBlock = (node: ChildNode): boolean => {
  if (!isDomElementNode(node)) return false;
  // Necessary for a match, and far cheaper than the prefix scan.
  if (!extractTextFromChildren(node.children).trimStart().startsWith(MINDROOM_TOOL_REF_ICON)) {
    return false;
  }
  let found = false;
  takeLeadingToolRefs(node, (html) => {
    found = parseToolBlockMarker(html) !== undefined;
    return false;
  });
  return found;
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

/** Whether the HTML shows anything once sanitized as `RenderBody` sanitizes it. */
const rendersVisibleContent = (html: string): boolean =>
  hasVisibleContent(htmlToDOM(sanitizeCustomHtml(html)) as ChildNode[]);

/**
 * Splits a finished agent reply's HTML after the top-level block that holds its last tool marker,
 * or returns undefined when it has no marker or nothing visible follows the last one. The backend
 * writes every marker as a paragraph of its own, so the split falls between blocks.
 */
export const splitFinishedWork = (html: string): FinishedWorkSplit | undefined => {
  if (!html.includes(MINDROOM_TOOL_REF_ICON)) return undefined;
  const nodes = htmlToDOM(html) as ChildNode[];
  let last = -1;
  nodes.forEach((node, index) => {
    if (startsWithToolBlock(node)) last = index;
  });
  if (last < 0) return undefined;
  const tail = nodes
    .slice(last + 1)
    .map(serializeHtmlNode)
    .join('');
  if (!rendersVisibleContent(tail)) return undefined;
  return {
    head: nodes
      .slice(0, last + 1)
      .map(serializeHtmlNode)
      .join(''),
    tail,
  };
};
