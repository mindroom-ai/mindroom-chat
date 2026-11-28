import { Element, Text as DOMText, type HTMLReactParserOptions } from 'html-react-parser';
import { isText, type ChildNode } from 'domhandler';
import { MINDROOM_TOOL_REF_ICON, parseToolRefHtml } from '../html/blocks';
import { isFootnoteHref, isFootnoteId } from '../../rich-text/sanitize';
import { isDomElementNode, splitLeadingToolRefs } from './toolRefDom';
import { cloneDomNodes, domContainsText, getReplySlot, isBlankOrBreak } from './replyDomNodes';
import { inspectRenderedToolCalls } from '../html/HtmlBlocks';

export type FinishedWorkDomSplit = { work: ChildNode[]; answer: ChildNode[] };
export type FinishedWorkDomResult = { toolCallIndexes: number[]; split?: FinishedWorkDomSplit };

const MEDIA_ELEMENTS = new Set(['img', 'video', 'audio']);
const INVISIBLE_TEXT = /[\s⏳\u200B-\u200D\u2060\uFEFF]|\uFE0F/gu;
const NO_DRAWN_CALLS: ReadonlySet<number> = new Set();
const TAKE_ALL = () => true;

const collectFootnoteAnchors = (
  nodes: readonly ChildNode[],
  ids = new Set<string>(),
  targets = new Set<string>()
) => {
  for (const node of nodes) {
    if (!isDomElementNode(node)) continue;
    if ((node.name === 'a' || node.name === 'li') && isFootnoteId(node.attribs.id)) {
      ids.add(node.attribs.id);
    }
    if (node.name === 'a' && isFootnoteHref(node.attribs.href)) {
      targets.add(node.attribs.href.slice(1));
    }
    collectFootnoteAnchors(node.children, ids, targets);
  }
  return { ids, targets };
};

const hasCrossHalfFootnote = (
  work: readonly ChildNode[],
  answer: readonly ChildNode[]
): boolean => {
  const head = collectFootnoteAnchors(work);
  const tail = collectFootnoteAnchors(answer);
  for (const t of head.targets) if (!head.ids.has(t) && tail.ids.has(t)) return true;
  for (const t of tail.targets) if (!tail.ids.has(t) && head.ids.has(t)) return true;
  return false;
};

const isVisibleLeaf = (node: ChildNode): boolean =>
  isText(node)
    ? node.data.replace(INVISIBLE_TEXT, '') !== ''
    : isDomElementNode(node) && (getReplySlot(node) !== undefined || MEDIA_ELEMENTS.has(node.name));

const hasVisibleWork = (
  nodes: readonly ChildNode[],
  drawn: ReadonlySet<number> = NO_DRAWN_CALLS
): boolean =>
  nodes.some((node) => {
    if (isVisibleLeaf(node)) return true;
    if (!isDomElementNode(node)) return false;
    if (drawn.size > 0) {
      const { trailing, count } = splitLeadingToolRefs(
        node,
        (marker) => {
          const parsed = parseToolRefHtml(marker);
          return parsed !== undefined && drawn.has(parsed.index);
        },
        true
      );
      if (count > 0) return hasVisibleWork(trailing, drawn);
    }
    return hasVisibleWork(node.children, drawn);
  });

const hasVisibleAfterLastToolRef = (node: ChildNode): boolean => {
  let visibleAfter = false;
  const visit = (nodes: readonly ChildNode[]) => {
    for (const child of nodes) {
      if (isVisibleLeaf(child)) visibleAfter = true;
      else if (isDomElementNode(child)) {
        const { trailing, count } = splitLeadingToolRefs(child, TAKE_ALL, true);
        if (count > 0) {
          visibleAfter = false;
          visit(trailing);
        } else visit(child.children);
      }
    }
  };
  visit([node]);
  return visibleAfter;
};

const cutAfterCallsDom = (node: ChildNode): [ChildNode[], ChildNode[]] | undefined => {
  if (!isDomElementNode(node) || node.name !== 'p') {
    return hasVisibleAfterLastToolRef(node) ? undefined : [[node], []];
  }
  const { leading, trailing, count } = splitLeadingToolRefs(node, TAKE_ALL, true);
  if (!hasVisibleWork(trailing)) return [[node], []];
  if (count === 0) return undefined;

  while (leading.length > 0 && isBlankOrBreak(leading[leading.length - 1])) leading.pop();
  const last = leading[leading.length - 1];
  if (last && isText(last)) leading[leading.length - 1] = new DOMText(last.data.trimEnd());

  const first = trailing[0];
  if (first && isText(first)) trailing[0] = new DOMText(first.data.trimStart());

  return [
    [new Element('p', { ...node.attribs }, leading)],
    [new Element('p', { ...node.attribs }, trailing)],
  ];
};

/** Splits a finished reply's sanitized DOM after the last drawn tool call. */
export const splitFinishedWorkDom = (
  dom: readonly ChildNode[],
  baseOpts: HTMLReactParserOptions
): FinishedWorkDomResult => {
  const nodes = cloneDomNodes(dom);
  if (!domContainsText(nodes, MINDROOM_TOOL_REF_ICON)) return { toolCallIndexes: [] };
  const { indexes, lastNode } = inspectRenderedToolCalls(nodes, baseOpts);
  if (lastNode < 0) return { toolCallIndexes: indexes };
  const drawn = new Set(indexes);
  let end = lastNode + 1;
  for (;;) {
    const tail = nodes.slice(end);
    const drawnInTail = domContainsText(tail, MINDROOM_TOOL_REF_ICON)
      ? inspectRenderedToolCalls(tail, baseOpts).lastNode
      : -1;
    if (drawnInTail < 0) {
      const last = nodes[end - 1];
      const cut = last && cutAfterCallsDom(last);
      if (!cut) return { toolCallIndexes: indexes };
      const work = cloneDomNodes([...nodes.slice(0, end - 1), ...cut[0]]);
      const answer = cloneDomNodes([...cut[1], ...tail]);
      if (hasCrossHalfFootnote(work, answer)) return { toolCallIndexes: indexes };
      return hasVisibleWork(work, drawn) && hasVisibleWork(answer)
        ? { toolCallIndexes: indexes, split: { work, answer } }
        : { toolCallIndexes: indexes };
    }
    end += drawnInTail + 1;
  }
};
