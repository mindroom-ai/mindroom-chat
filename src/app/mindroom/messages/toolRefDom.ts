import { Element, Text as DOMText, htmlToDOM } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import {
  MINDROOM_TOOL_REF_ICON,
  MindroomToolRefParseResult,
  parseMindroomToolRefHtml,
} from './blocks';

// DOM-only helpers for MindRoom tool markers, shared by the renderer and by
// copy so both agree on which markers display as tool blocks.

export const isDomTextNode = (node: unknown): node is DOMText =>
  typeof node === 'object' &&
  node !== null &&
  typeof (node as { data?: unknown }).data === 'string' &&
  !Array.isArray((node as { children?: unknown }).children);

export const isDomElementNode = (node: unknown): node is Element =>
  typeof node === 'object' &&
  node !== null &&
  typeof (node as { name?: unknown }).name === 'string' &&
  Array.isArray((node as { children?: unknown }).children);

export const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (isDomTextNode(node)) {
      text += node.data;
    } else if (isDomElementNode(node)) {
      text += extractTextFromChildren((node as { children: ChildNode[] }).children);
    }
  });

  return text;
};

export type ToolRefElementPrefix = {
  html: string;
  trailingChildren: ChildNode[];
};

type ToolRefMatchBoundary = {
  html: string;
  childIndex: number;
  textSplitIndex: number | undefined;
};

export const trimLeadingToolRefBoundary = (children: ChildNode[]): ChildNode[] => {
  const remaining = [...children];

  const trimLeadingWhitespaceText = () => {
    while (remaining.length > 0) {
      const first = remaining[0];
      if (!isDomTextNode(first) || first.data.trim()) break;
      remaining.shift();
    }
  };

  trimLeadingWhitespaceText();

  if (remaining.length > 0 && isDomElementNode(remaining[0]) && remaining[0].name === 'br') {
    remaining.shift();
    trimLeadingWhitespaceText();
  }

  return remaining;
};

export const parseToolRefIndexFromTextPrefix = (text: string): number | undefined => {
  const match = /^\s*🔧[\s\S]*?\[(\d+)\](?:\s*⏳)?/u.exec(text);
  if (!match) return undefined;

  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1) return undefined;
  return index;
};

export const getToolRefPrefixFromElement = (element: Element): ToolRefElementPrefix | undefined => {
  if (!['p', 'div', 'li'].includes(element.name)) return undefined;

  let html = '';
  let bestMatch: ToolRefMatchBoundary | undefined;

  const buildPrefixResult = (match: ToolRefMatchBoundary): ToolRefElementPrefix => {
    const matchedChild = element.children[match.childIndex];
    const trailingText =
      isDomTextNode(matchedChild) && match.textSplitIndex !== undefined
        ? matchedChild.data.slice(match.textSplitIndex)
        : '';
    const trailingChildren = trimLeadingToolRefBoundary([
      ...(trailingText ? [new DOMText(trailingText)] : []),
      ...element.children.slice(match.childIndex + 1),
    ]);

    return {
      html: match.html,
      trailingChildren,
    };
  };

  for (let childIndex = 0; childIndex < element.children.length; childIndex += 1) {
    const child = element.children[childIndex];

    if (isDomTextNode(child)) {
      for (let splitIndex = 0; splitIndex <= child.data.length; splitIndex += 1) {
        const candidate = `${html}${child.data.slice(0, splitIndex)}`;
        if (parseMindroomToolRefHtml(candidate)) {
          // Prefer the longest valid marker prefix (e.g. include optional " ⏳" when present).
          bestMatch = {
            html: candidate,
            childIndex,
            textSplitIndex: splitIndex,
          };
        }
      }

      html += child.data;
    } else if (isDomElementNode(child) && child.name === 'code') {
      html += `<code>${extractTextFromChildren(child.children)}</code>`;

      if (parseMindroomToolRefHtml(html)) {
        bestMatch = {
          html,
          childIndex,
          textSplitIndex: undefined,
        };
      }
    } else if (isDomElementNode(child) && child.name === 'span') {
      html += extractTextFromChildren(child.children);

      if (parseMindroomToolRefHtml(html)) {
        bestMatch = {
          html,
          childIndex,
          textSplitIndex: undefined,
        };
      }
    } else if (bestMatch) {
      return buildPrefixResult(bestMatch);
    } else {
      return undefined;
    }
  }

  if (!bestMatch) return undefined;
  return buildPrefixResult(bestMatch);
};

export const countMindroomToolRefIcons = (text: string): number =>
  text.split(MINDROOM_TOOL_REF_ICON).length - 1;

export type RenderedMindroomToolRefs = {
  /** Markers shown as tool blocks, in document order. */
  toolBlocks: MindroomToolRefParseResult[];
  /**
   * 🔧 icons anywhere in the rendered text or in any attribute, tool-block
   * markers included. Attributes count because the renderer shows some, such
   * as KaTeX `data-mx-maths` and code-block labels.
   */
  iconCount: number;
  /** 🔧 icons inside the tool-block markers. */
  toolBlockIconCount: number;
};

/**
 * Tool markers the message renderer shows as tool blocks in this sanitized
 * HTML. The renderer applies its tool rule to top-level containers and to the
 * content it re-wraps after a marker. The base parser renders lists, quotes,
 * and headings with its own options, so markers there stay text; wrappers it
 * leaves alone (`div`, `details`) do show nested markers, which this skips.
 */
export const getRenderedMindroomToolRefs = (html: string): RenderedMindroomToolRefs => {
  const toolBlocks: MindroomToolRefParseResult[] = [];
  let toolBlockIconCount = 0;
  const visit = (node: ChildNode) => {
    if (!isDomElementNode(node)) return;
    // Necessary for a match, and far cheaper than the prefix scan.
    const text = extractTextFromChildren(node.children as ChildNode[]);
    if (!text.trimStart().startsWith(MINDROOM_TOOL_REF_ICON)) return;

    const prefix = getToolRefPrefixFromElement(node);
    const toolRef = prefix ? parseMindroomToolRefHtml(prefix.html) : undefined;
    if (!prefix || !toolRef) return;
    // The renderer groups by the first bracketed number in the text, so a name
    // holding another index can hide the block; count it as text instead.
    if (parseToolRefIndexFromTextPrefix(text) !== toolRef.index) return;

    toolBlocks.push(toolRef);
    toolBlockIconCount += countMindroomToolRefIcons(prefix.html);
    if (prefix.trailingChildren.length > 0) {
      visit(new Element(node.name, { ...node.attribs }, prefix.trailingChildren));
    }
  };

  const countAttributeIcons = (nodes: ChildNode[]): number =>
    nodes.reduce(
      (count, node) =>
        isDomElementNode(node)
          ? count +
            Object.values(node.attribs).reduce(
              (sum, value) => sum + countMindroomToolRefIcons(value),
              0
            ) +
            countAttributeIcons(node.children as ChildNode[])
          : count,
      0
    );

  const nodes = htmlToDOM(html) as ChildNode[];
  nodes.forEach(visit);
  return {
    toolBlocks,
    iconCount:
      countMindroomToolRefIcons(extractTextFromChildren(nodes)) + countAttributeIcons(nodes),
    toolBlockIconCount,
  };
};
