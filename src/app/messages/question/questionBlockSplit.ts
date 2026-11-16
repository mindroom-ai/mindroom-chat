import { htmlToDOM } from 'html-react-parser';
import { isText, type ChildNode } from 'domhandler';
import {
  INTERACTIVE_INSTRUCTION_TEXT,
  type InteractiveQuestion,
} from '../../matrix/protocol/interactiveQuestion';
import { serializeHtmlNode } from '../agent-run/finishedWorkSplit';
import { extractTextFromChildren, isDomElementNode } from '../agent-run/toolRefDom';

export type QuestionBlockSplit = {
  /** The reply's HTML before the question; empty when the question opens it. */
  before: string;
  /** The reply's HTML after the question's instruction line; empty when the question ends it. */
  after: string;
};

/**
 * Letters, digits and emoji only, so a question's Markdown source (`**Ready**?`) and the text of
 * its HTML (`Ready?`) compare equal.
 */
const loose = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]+/gu, '');

const textOf = (node: ChildNode | undefined): string =>
  !node
    ? ''
    : isText(node)
    ? node.data
    : isDomElementNode(node)
    ? extractTextFromChildren(node.children)
    : '';

const isBlank = (node: ChildNode | undefined): boolean =>
  !!node && isText(node) && node.data.trim() === '';

/** Whether `node` is the list MindRoom writes the options as: `<emoji> <label>`, in order. */
const isOptionList = (node: ChildNode | undefined, question: InteractiveQuestion): boolean => {
  if (!node || !isDomElementNode(node) || node.name !== 'ol') return false;
  const items = node.children.filter((child) => !isBlank(child));
  return (
    items.length === question.options.length &&
    items.every((item, index) => {
      const option = question.options[index];
      return (
        !!option &&
        isDomElementNode(item) &&
        item.name === 'li' &&
        loose(textOf(item)) === loose(`${option.key} ${option.label}`)
      );
    })
  );
};

/**
 * Finds the question MindRoom wrote into a reply's HTML in place of its interactive block: the
 * question's paragraphs, the numbered options, and the instruction line under them, all top-level
 * blocks in a row. Returns the HTML around it, or undefined when the reply does not hold it as
 * written (the card then goes under the whole reply).
 */
export const splitQuestionBlock = (
  html: string,
  question: InteractiveQuestion
): QuestionBlockSplit | undefined => {
  const wanted = loose(question.text);
  if (!wanted) return undefined;
  const nodes = htmlToDOM(html) as ChildNode[];
  for (let list = 0; list < nodes.length; list += 1) {
    if (isOptionList(nodes[list], question)) {
      // The question ends right before the list, perhaps over several paragraphs.
      let start = list;
      let text = '';
      while (start > 0 && text.length < wanted.length) {
        start -= 1;
        if (!isBlank(nodes[start])) text = loose(textOf(nodes[start])) + text;
        if (!wanted.endsWith(text)) break;
      }
      if (text === wanted) {
        let end = list + 1;
        while (end < nodes.length && isBlank(nodes[end])) end += 1;
        const instruction = nodes[end];
        end =
          instruction && loose(textOf(instruction)) === loose(INTERACTIVE_INSTRUCTION_TEXT)
            ? end + 1
            : list + 1;
        return {
          before: nodes.slice(0, start).map(serializeHtmlNode).join(''),
          after: nodes.slice(end).map(serializeHtmlNode).join(''),
        };
      }
    }
  }
  return undefined;
};
