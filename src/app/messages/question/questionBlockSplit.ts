import { htmlToDOM } from 'html-react-parser';
import { isText, type ChildNode } from 'domhandler';
import {
  INTERACTIVE_INSTRUCTION_TEXT,
  type InteractiveQuestion,
} from '../../matrix/protocol/interactiveQuestion';
import { serializeHtmlNode } from '../agent-run/finishedWorkSplit';
import { isDomElementNode } from '../agent-run/toolRefDom';
import { formatMarkdownTextBodyAsHtml } from '../html/blocks';

export type QuestionBlockSplit = {
  /** The reply's HTML before the question; empty when the question opens it. */
  before: string;
  /** The reply's HTML after the question's instruction line; empty when the question ends it. */
  after: string;
};

// Text formatting the question's Markdown can render as; anything else (an image) is content the
// card would not show, so a block holding it is not taken for the question.
const INLINE_TAGS = new Set([
  'a',
  'b',
  'br',
  'code',
  'del',
  'em',
  'font',
  'i',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
]);

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The text of nodes that hold only text and inline formatting, else undefined. */
const inlineText = (nodes: ChildNode[]): string | undefined => {
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

/** The text of an element named `name` that holds only text and inline formatting. */
const blockText = (node: ChildNode | undefined, name: string): string | undefined =>
  node && isDomElementNode(node) && node.name === name ? inlineText(node.children) : undefined;

/** The ways a line of Markdown may read once rendered: as written, or as the app renders it. */
const renderings = (markdown: string): string[] => {
  const html = formatMarkdownTextBodyAsHtml(markdown);
  const rendered = html ? inlineText(htmlToDOM(html) as ChildNode[]) : undefined;
  return [normalize(markdown), ...(rendered === undefined ? [] : [normalize(rendered)])];
};

const isBlank = (node: ChildNode): boolean => isText(node) && node.data.trim() === '';

/**
 * Finds the question MindRoom wrote into a reply's HTML in place of its interactive block, exactly
 * as it writes it: the question's paragraphs, the list of options (`<emoji> <label>`, in order) and
 * the instruction line, siblings in a row with only whitespace between them and nothing in them
 * but text. The last such block counts, since an earlier one can be an example the reply quotes.
 * Returns the HTML around it, or undefined when there is no such block (the card then goes under
 * the whole reply, which stays as it is).
 */
export const splitQuestionBlock = (
  html: string,
  question: InteractiveQuestion
): QuestionBlockSplit | undefined => {
  const paragraphs = question.text
    .split(/\n[ \t]*\n/)
    .filter((paragraph) => paragraph.trim() !== '')
    .map(renderings);
  if (paragraphs.length === 0) return undefined;
  const options = question.options.map((option) => renderings(`${option.key} ${option.label}`));
  const instruction = normalize(INTERACTIVE_INSTRUCTION_TEXT);
  const all = htmlToDOM(html) as ChildNode[];
  // The blocks with their places in the HTML, whitespace between them left out.
  const blocks = all.flatMap((node, index) => (isBlank(node) ? [] : [{ node, index }]));
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

  for (let end = blocks.length - 1; end >= paragraphs.length + 1; end -= 1) {
    const start = end - 1 - paragraphs.length;
    const first = blocks[start];
    const last = blocks[end];
    if (
      first &&
      last &&
      matches(blockText(last.node, 'p'), [instruction]) &&
      isOptionList(blocks[end - 1]?.node) &&
      paragraphs.every((accepted, offset) =>
        matches(blockText(blocks[start + offset]?.node, 'p'), accepted)
      )
    ) {
      return {
        before: all.slice(0, first.index).map(serializeHtmlNode).join(''),
        after: all
          .slice(last.index + 1)
          .map(serializeHtmlNode)
          .join(''),
      };
    }
  }
  return undefined;
};
