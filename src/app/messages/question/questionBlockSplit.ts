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

/**
 * Stands in for the question's block in a reply's HTML, so the card goes where the block was in
 * whichever part of the reply holds it once its finished work folds: private-use characters,
 * which no reply writes, in a paragraph of its own, which the fold's split keeps whole.
 */
export const QUESTION_CARD_PLACE = '<p>\uE000question-card\uE000</p>';

const TEXT_BLOCK_TAGS = new Set(['p', 'ol', 'li']);

const holdsOnlyText = (nodes: ChildNode[]): boolean =>
  nodes.every(
    (node) =>
      isText(node) ||
      (isDomElementNode(node) &&
        (INLINE_TAGS.has(node.name) || TEXT_BLOCK_TAGS.has(node.name)) &&
        holdsOnlyText(node.children))
  );

/**
 * The HTML of an agent reply that has only its Markdown body, with the question's block marked by
 * `QUESTION_CARD_PLACE`: the block exactly as MindRoom writes it into the body (the question, a
 * blank line, `N. <emoji> <label>` lines, a blank line, the instruction line), on lines of its
 * own, its last occurrence, and the text around it formatted as the body would be. Undefined when
 * the body holds no such block, the block would show more than text, or a part cannot be formatted.
 */
export const formatQuestionBody = (
  body: string,
  question: InteractiveQuestion
): string | undefined => {
  const source = body.replace(/\r\n?/g, '\n');
  const block = [
    question.text,
    '',
    ...question.options.map((option, index) => `${index + 1}. ${option.key} ${option.label}`),
    '',
    INTERACTIVE_INSTRUCTION_TEXT,
  ].join('\n');
  const at = source.lastIndexOf(block);
  const end = at + block.length;
  if (
    at < 0 ||
    (at > 0 && source[at - 1] !== '\n') ||
    (end < source.length && source[end] !== '\n')
  ) {
    return undefined;
  }
  const blockHtml = formatMarkdownTextBodyAsHtml(block);
  if (!blockHtml || !holdsOnlyText(htmlToDOM(blockHtml) as ChildNode[])) return undefined;
  const format = (part: string): string | undefined =>
    part.trim() === '' ? '' : formatMarkdownTextBodyAsHtml(part) || undefined;
  // The blank lines around the block part it from its neighbours, as the card does.
  const before = format(source.slice(0, at).replace(/\n+$/, ''));
  const after = format(source.slice(end).replace(/^\n+/, ''));
  if (before === undefined || after === undefined) return undefined;
  return `${before}${QUESTION_CARD_PLACE}${after}`;
};
