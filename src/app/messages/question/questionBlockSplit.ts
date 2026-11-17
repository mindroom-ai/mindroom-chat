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

const isBlank = (node: ChildNode | undefined): boolean =>
  !!node && isText(node) && node.data.trim() === '';
const isBreak = (node: ChildNode | undefined): boolean =>
  !!node && isDomElementNode(node) && node.name === 'br';
// Elements that stand as blocks of their own beside the text runs between them.
const BLOCK_TAGS = new Set(
  'blockquote details div h1 h2 h3 h4 h5 h6 hr ol p pre table ul'.split(' ')
);

/**
 * A top-level part of a reply's HTML, `all[start..end)`: a block element, or a run of text and
 * inline elements between blocks and blank lines (`<br/><br/>`), as the app's formatter writes a
 * body-only reply's paragraphs. `text` is its text when it holds nothing but text: a `<p>` or a run.
 */
type Part = { start: number; end: number; node?: ChildNode; text?: string };

const partsOf = (all: ChildNode[]): Part[] => {
  const parts: Part[] = [];
  let run: number | undefined;
  const closeRun = (end: number) => {
    const nodes = run === undefined ? [] : all.slice(run, end);
    if (run !== undefined && !nodes.every((node) => isBlank(node) || isBreak(node))) {
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
        // A blank line ends the run.
        closeRun(index);
        index = next;
      } else run ??= index;
    } else run ??= index;
  }
  closeRun(all.length);
  return parts;
};

/**
 * Finds the question MindRoom wrote into a reply's HTML in place of its interactive block, exactly
 * as it writes it: the question's paragraphs, the list of options (`<emoji> <label>`, in order) and
 * the instruction line, top-level parts in a row with nothing in them but text. The paragraphs are
 * `<p>` elements in the backend's HTML and runs between blank lines in the HTML the app formats from
 * a body-only reply; code, math and quotes are elements of their own and never match. The last such
 * block counts, since an earlier one can be an example the reply quotes. Returns the HTML around it,
 * or undefined when there is no such block (the card then goes under the whole reply, which stays
 * as it is).
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
  const parts = partsOf(all);
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
      // The blank lines next to the block go with it: the card stands apart on its own.
      let from = first.start;
      while (from > 0 && (isBlank(all[from - 1]) || isBreak(all[from - 1]))) from -= 1;
      let to = last.end;
      while (to < all.length && (isBlank(all[to]) || isBreak(all[to]))) to += 1;
      return {
        before: all.slice(0, from).map(serializeHtmlNode).join(''),
        after: all.slice(to).map(serializeHtmlNode).join(''),
      };
    }
  }
  return undefined;
};
