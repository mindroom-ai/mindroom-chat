import { type IContent, MsgType } from 'matrix-js-sdk';
import { type Descendant, type Editor, Text } from 'slate';
import {
  customHtmlEqualsPlainText,
  getMentions,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
} from '../../components/editor';
import type { ParagraphElement } from '../../components/editor/slate';
import { BlockType } from '../../components/editor/types';

/** The commands that pick a message type, as typed at the very start of the message. */
const MSGTYPE_BY_COMMAND: ReadonlyMap<string, MsgType> = new Map([
  ['me', MsgType.Emote],
  ['notice', MsgType.Notice],
]);

/** `/me` or `/notice` as a word of its own, and the blank space after it. */
const LEADING_COMMAND = /^\/(me|notice)(?:\s+|$)/;

const isParagraph = (node: Descendant | undefined): node is ParagraphElement =>
  !!node && 'type' in node && node.type === BlockType.Paragraph;

/**
 * Splits a leading `/me` or `/notice` off the composer's text: the message type it picks, and
 * the document without it. Only plain text at the start of the first paragraph counts, so a
 * command inside a code block or a quote is sent as written.
 */
export const takeMsgtypeCommand = (
  document: Descendant[]
): { msgtype: MsgType; document: Descendant[] } => {
  const asWritten = { msgtype: MsgType.Text, document };
  const [firstBlock, ...otherBlocks] = document;
  if (!isParagraph(firstBlock)) return asWritten;
  const [firstRun, ...otherRuns] = firstBlock.children;
  if (!Text.isText(firstRun)) return asWritten;
  const command = LEADING_COMMAND.exec(firstRun.text);
  const msgtype = command && MSGTYPE_BY_COMMAND.get(command[1] ?? '');
  if (!command || !msgtype) return asWritten;
  const rest = { ...firstRun, text: firstRun.text.slice(command[0].length) };
  const paragraph: ParagraphElement = { ...firstBlock, children: [rest, ...otherRuns] };
  return { msgtype, document: [paragraph, ...otherBlocks] };
};

/**
 * The message the composer holds, or undefined when no text is left to send: the plain body,
 * HTML only when it says more than the body, and the mentions the text holds as pills.
 */
export const composeTextMessage = (
  editor: Editor,
  markdown: boolean,
  ownUserId: string | undefined
): IContent | undefined => {
  const { msgtype, document } = takeMsgtypeCommand(editor.children);
  const body = toPlainText(document, markdown).trim();
  if (body === '') return undefined;
  const html = trimCustomHtml(
    toMatrixCustomHTML(document, {
      allowInlineMarkdown: markdown,
      allowBlockMarkdown: markdown,
      allowTextFormatting: true,
    })
  );

  // Intentional mentions (MSC3952): only the users and @room the composer holds as pills.
  const { users, room: mentionsRoom } = getMentions(editor, ownUserId);
  const mentions: { user_ids?: string[]; room?: boolean } = {};
  if (users.size > 0) mentions.user_ids = [...users];
  if (mentionsRoom) mentions.room = true;

  const formatted = customHtmlEqualsPlainText(html, body)
    ? {}
    : { format: 'org.matrix.custom.html', formatted_body: html };
  return { msgtype, body, ...formatted, 'm.mentions': mentions };
};
