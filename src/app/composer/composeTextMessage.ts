import { type IContent, MsgType } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { type MessageCommand, sendsAsTyped, takeMessageCommand } from '../editor/messageCommand';
import { getMentions } from '../editor/utils';
import {
  customHtmlEqualsPlainText,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
} from '../editor/output';

/** The message types `/me` and `/notice` pick. */
const MSGTYPE_BY_COMMAND: ReadonlyMap<MessageCommand, MsgType> = new Map([
  ['me', MsgType.Emote],
  ['notice', MsgType.Notice],
]);

/**
 * The message the composer holds, or undefined when no text is left to send: the plain body,
 * HTML only when it says more than the body, and the mentions the text holds as pills.
 * `linkSchemes` are the extra URI schemes Markdown links may use, as received links may.
 */
export const composeTextMessage = (
  editor: Editor,
  markdown: boolean,
  ownUserId: string | undefined,
  linkSchemes?: readonly string[]
): IContent | undefined => {
  const { command, document } = takeMessageCommand(editor.children);
  const msgtype = (command && MSGTYPE_BY_COMMAND.get(command)) ?? MsgType.Text;
  // `/plain` sends what was typed as it is, without reading Markdown in it.
  const readMarkdown = markdown && !sendsAsTyped(command);
  const body = toPlainText(document, readMarkdown).trim();
  if (body === '') return undefined;
  const formattedHtml = (): string | undefined => {
    if (command === 'plain') return undefined;
    return trimCustomHtml(
      toMatrixCustomHTML(document, {
        allowInlineMarkdown: readMarkdown,
        allowBlockMarkdown: readMarkdown,
        allowTextFormatting: true,
        linkSchemes,
      })
    );
  };
  const html = formattedHtml();

  // Intentional mentions (MSC3952): only the users and @room the composer holds as pills.
  const { users, room: mentionsRoom } = getMentions(editor, ownUserId);
  const mentions: { user_ids?: string[]; room?: boolean } = {};
  if (users.size > 0) mentions.user_ids = [...users];
  if (mentionsRoom) mentions.room = true;

  const formatted =
    html === undefined || customHtmlEqualsPlainText(html, body)
      ? {}
      : { format: 'org.matrix.custom.html', formatted_body: html };
  return { msgtype, body, ...formatted, 'm.mentions': mentions };
};
