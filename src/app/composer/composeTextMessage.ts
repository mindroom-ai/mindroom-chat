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
import { SHRUG, TABLEFLIP, UNFLIP } from './commands/useCommands';

/** The message types `/me` and `/notice` pick. */
const MSGTYPE_BY_COMMAND: ReadonlyMap<MessageCommand, MsgType> = new Map([
  ['me', MsgType.Emote],
  ['notice', MsgType.Notice],
]);

/** The face each face command puts before the message. */
const FACE_BY_COMMAND: ReadonlyMap<MessageCommand, string> = new Map([
  ['shrug', SHRUG],
  ['tableflip', TABLEFLIP],
  ['unflip', UNFLIP],
]);

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The text a `/html` message shows without formatting: its tags dropped, entities read. */
const textOfHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith('#')) {
        const code =
          name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return HTML_ENTITIES[name.toLowerCase()] ?? entity;
    });

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
  const face = command && FACE_BY_COMMAND.get(command);
  // `/plain` and `/html` send what was typed as it is, without reading Markdown in it.
  const readMarkdown = markdown && !sendsAsTyped(command);
  const typed = toPlainText(document, readMarkdown).trim();
  if (typed === '' && !face) return undefined;
  const formattedHtml = (): string | undefined => {
    if (command === 'plain') return undefined;
    if (command === 'html') return typed;
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
  const text = command === 'html' ? textOfHtml(typed).trim() : typed;
  const withFace = (value: string) => (face ? `${face} ${value}`.trim() : value);
  const body = withFace(text);

  // Intentional mentions (MSC3952): only the users and @room the composer holds as pills.
  const { users, room: mentionsRoom } = getMentions(editor, ownUserId);
  const mentions: { user_ids?: string[]; room?: boolean } = {};
  if (users.size > 0) mentions.user_ids = [...users];
  if (mentionsRoom) mentions.room = true;

  const formatted =
    html === undefined || customHtmlEqualsPlainText(html, text)
      ? {}
      : { format: 'org.matrix.custom.html', formatted_body: withFace(html) };
  return { msgtype, body, ...formatted, 'm.mentions': mentions };
};
