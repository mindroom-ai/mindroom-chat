import type { ChildNode } from 'domhandler';
import { parseHtmlToDom } from '../../rich-text/parseHtml';
import {
  INTERACTIVE_INSTRUCTION_TEXT,
  type InteractiveQuestion,
} from '../../matrix/protocol/interactiveQuestion';
import {
  createReplySlotNode,
  expandOverBlanks,
  inlineText,
  isBlank,
  normalize,
  topLevelParts,
} from '../agent-run/replyDomNodes';
import { isDomElementNode } from '../agent-run/toolRefDom';
import { formatMarkdownTextBodyAsHtml } from '../html/blocks';

const blockText = (node: ChildNode | undefined, name: string): string | undefined =>
  node && isDomElementNode(node) && node.name === name ? inlineText(node.children) : undefined;

const renderings = (markdown: string): string[] => {
  const html = formatMarkdownTextBodyAsHtml(markdown);
  const rendered = html ? inlineText(parseHtmlToDom(html)) : undefined;
  return [normalize(markdown), ...(rendered === undefined ? [] : [normalize(rendered)])];
};

/**
 * Replaces the last matching interactive question block (question paragraphs, numbered `<ol>`
 * options, and instruction line) with a symbol-tagged questionCard slot node. Returns undefined
 * when no matching block exists.
 */
export const placeQuestionCardInDom = (
  dom: readonly ChildNode[],
  question: InteractiveQuestion
): ChildNode[] | undefined => {
  const paragraphs = question.text
    .split(/\n[ \t]*\n/)
    .filter((paragraph) => paragraph.trim() !== '')
    .map(renderings);
  if (paragraphs.length === 0) return undefined;
  const options = question.options.map((option) => renderings(`${option.key} ${option.label}`));
  const instruction = normalize(INTERACTIVE_INSTRUCTION_TEXT);
  const parts = topLevelParts(dom);
  const matches = (text: string | undefined, accepted: string[]) =>
    text !== undefined && accepted.includes(normalize(text));

  const isOptionList = (node: ChildNode | undefined): boolean => {
    if (!node || !isDomElementNode(node) || node.name !== 'ol') return false;
    const items = node.children.filter((child) => !isBlank(child));
    return (
      items.length === options.length &&
      items.every((item, index) => matches(blockText(item, 'li'), options[index] ?? []))
    );
  };

  for (let end = parts.length - 1; end >= paragraphs.length + 1; end -= 1) {
    const start = end - 1 - paragraphs.length;
    const first = parts[start];
    const last = parts[end];
    if (
      first &&
      last &&
      matches(last.text, [instruction]) &&
      isOptionList(parts[end - 1]?.node) &&
      paragraphs.every((accepted, offset) => matches(parts[start + offset]?.text, accepted))
    ) {
      const [from, to] = expandOverBlanks(dom, first.start, last.end);
      return [
        ...dom.slice(0, from),
        createReplySlotNode({ kind: 'questionCard' }),
        ...dom.slice(to),
      ];
    }
  }
  return undefined;
};
