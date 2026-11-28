import { isText, type ChildNode } from 'domhandler';
import {
  Element,
  Text as DOMText,
  type DOMNode,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import { parseHtmlToDom } from '../../rich-text/parseHtml';
import { isDomElementNode } from './toolRefDom';

export const REPLY_SLOT = Symbol('mindroomReplySlot');
export type ReplySlot = { kind: 'restartSeam'; count: number } | { kind: 'questionCard' };
type SlotElement = Element & { [REPLY_SLOT]?: ReplySlot };

export const createReplySlotNode = (slot: ReplySlot): Element =>
  Object.assign(new Element('p', {}, []), { [REPLY_SLOT]: slot });

export const getReplySlot = (node: DOMNode | ChildNode | undefined): ReplySlot | undefined =>
  node && isDomElementNode(node) ? (node as SlotElement)[REPLY_SLOT] : undefined;

const INLINE_TAGS = new Set('a b br code del em font i s span strike strong sub sup u'.split(' '));
const BLOCK_TAGS = new Set(
  'blockquote details div h1 h2 h3 h4 h5 h6 hr ol p pre table ul'.split(' ')
);

export const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();
export const isBlank = (node: ChildNode | undefined): boolean =>
  !!node && isText(node) && node.data.trim() === '';
export const isBreak = (node: ChildNode | undefined): boolean =>
  !!node && isDomElementNode(node) && node.name === 'br';
export const isBlankOrBreak = (node: ChildNode | undefined): boolean =>
  isBlank(node) || isBreak(node);

/** Expands `[start, end)` to consume adjacent whitespace text and `<br>` nodes down to `minStart`. */
export const expandOverBlanks = (
  nodes: readonly ChildNode[],
  start: number,
  end: number,
  minStart = 0
): [number, number] => {
  let from = start;
  while (from > minStart && isBlankOrBreak(nodes[from - 1])) from -= 1;
  let to = end;
  while (to < nodes.length && isBlankOrBreak(nodes[to])) to += 1;
  return [from, to];
};

/** The text of nodes that hold only text and inline formatting, else undefined. */
export const inlineText = (nodes: readonly ChildNode[]): string | undefined => {
  let text = '';
  for (const node of nodes) {
    if (isText(node)) text += node.data;
    else if (!isDomElementNode(node) || !INLINE_TAGS.has(node.name)) return undefined;
    else if (node.name === 'br') text += '\n';
    else {
      const inner = inlineText(node.children);
      if (inner === undefined) return undefined;
      text += inner;
    }
  }
  return text;
};

export type TopLevelPart = { start: number; end: number; node?: ChildNode; text?: string };

/** Splits top-level DOM nodes into block elements and inline runs separated by `<br><br>`. */
export const topLevelParts = (all: readonly ChildNode[]): TopLevelPart[] => {
  const parts: TopLevelPart[] = [];
  let run: number | undefined;
  const closeRun = (end: number) => {
    const nodes = run === undefined ? [] : all.slice(run, end);
    if (run !== undefined && !nodes.every(isBlankOrBreak)) {
      parts.push({ start: run, end, text: inlineText(nodes) });
    }
    run = undefined;
  };
  for (let index = 0; index < all.length; index += 1) {
    const node = all[index];
    if (node && isDomElementNode(node) && BLOCK_TAGS.has(node.name)) {
      closeRun(index);
      const text = node.name === 'p' ? inlineText(node.children) : undefined;
      parts.push({ start: index, end: index + 1, node, ...(text === undefined ? {} : { text }) });
    } else if (isBreak(node)) {
      let next = index + 1;
      while (isBlank(all[next])) next += 1;
      if (isBreak(all[next])) {
        closeRun(index);
        index = next;
      } else run ??= index;
    } else run ??= index;
  }
  closeRun(all.length);
  return parts;
};

/** Deep-clones a `ChildNode[]` slice with clean `parent`, sibling links, and `[REPLY_SLOT]`. */
export const cloneDomNodes = (
  nodes: readonly ChildNode[],
  parent: Element | null = null
): (Element | DOMText)[] => {
  const cloned: (Element | DOMText)[] = [];
  for (const node of nodes) {
    let copy: Element | DOMText | undefined;
    if (isText(node)) copy = new DOMText(node.data);
    else if (isDomElementNode(node)) {
      const el = new Element(node.name, { ...node.attribs }, []) as SlotElement;
      el.children = cloneDomNodes(node.children, el);
      const slot = getReplySlot(node);
      if (slot) el[REPLY_SLOT] = slot;
      copy = el;
    }
    if (!copy) continue;
    const prev = cloned[cloned.length - 1] ?? null;
    copy.parent = parent;
    copy.prev = prev;
    copy.next = null;
    if (prev) prev.next = copy;
    cloned.push(copy);
  }
  return cloned;
};

/** Parses sanitized HTML into top-level DOM nodes matching the renderer's parser options. */
export const parseRenderedHtml = (
  html: string,
  baseOpts: Pick<HTMLReactParserOptions, 'htmlparser2'>
): ChildNode[] => parseHtmlToDom(html, baseOpts.htmlparser2 ?? { lowerCaseAttributeNames: false });

/** Whether any text node in `nodes` contains `needle`. */
export const domContainsText = (nodes: readonly ChildNode[], needle: string): boolean =>
  nodes.some((node) =>
    isText(node)
      ? node.data.includes(needle)
      : isDomElementNode(node) && domContainsText(node.children, needle)
  );
