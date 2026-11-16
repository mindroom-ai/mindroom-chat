import { htmlToDOM } from 'html-react-parser';
import type { ChildNode } from 'domhandler';
import { MINDROOM_TOOL_REF_ICON } from '../html/blocks';
import { sanitizeText } from '../../rich-text/sanitize';
import {
  extractTextFromChildren,
  isDomElementNode,
  isDomTextNode,
  parseToolBlockMarker,
  takeLeadingToolRefs,
} from './toolRefDom';

export type FinishedWorkSplit = {
  /** The work: everything up to and including the block of the last tool marker. */
  head: string;
  /** What follows the last tool marker: the reply's answer. */
  tail: string;
};

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

// The browser build parses with DOMParser, which reports no source positions, so the halves are
// written out again from the nodes. Comments and directives drop; the renderer sanitizes both.
const serialize = (node: ChildNode): string => {
  if (isDomTextNode(node)) return sanitizeText(node.data);
  if (!isDomElementNode(node)) return '';
  const attributes = Object.entries(node.attribs)
    .map(([name, value]) => ` ${name}="${sanitizeText(value)}"`)
    .join('');
  const open = `<${node.name}${attributes}>`;
  return VOID_ELEMENTS.has(node.name)
    ? open
    : `${open}${node.children.map(serialize).join('')}</${node.name}>`;
};

const computeSplit = (html: string): FinishedWorkSplit | undefined => {
  if (!html.includes(MINDROOM_TOOL_REF_ICON)) return undefined;
  const nodes = htmlToDOM(html) as ChildNode[];
  let last = -1;
  nodes.forEach((node, index) => {
    if (startsWithToolBlock(node)) last = index;
  });
  if (last < 0) return undefined;
  const tailNodes = nodes.slice(last + 1);
  if (extractTextFromChildren(tailNodes).trim() === '') return undefined;
  return {
    head: nodes
      .slice(0, last + 1)
      .map(serialize)
      .join(''),
    tail: tailNodes.map(serialize).join(''),
  };
};

// A timeline renders every row again on each streamed edit of any reply, so the split of each
// finished reply on screen is kept, the least recently used dropping first.
const SPLIT_CACHE_LIMIT = 256;
const splitCache = new Map<string, FinishedWorkSplit | undefined>();

/**
 * Splits a finished agent reply's HTML after the top-level block that holds its last tool marker,
 * or returns undefined when it has no marker or nothing but whitespace follows the last one. The
 * backend writes every marker as a paragraph of its own, so the split falls between blocks.
 */
export const splitFinishedWork = (html: string): FinishedWorkSplit | undefined => {
  if (splitCache.has(html)) {
    const split = splitCache.get(html);
    splitCache.delete(html);
    splitCache.set(html, split);
    return split;
  }
  const split = computeSplit(html);
  splitCache.set(html, split);
  if (splitCache.size > SPLIT_CACHE_LIMIT) {
    const oldest = splitCache.keys().next().value;
    if (oldest !== undefined) splitCache.delete(oldest);
  }
  return split;
};

/** A run's duration as T3 Code shows it: `45s`, `2m 13s`, `1h 4m`. */
export const formatWorkDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};
