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
import { type Command, SHRUG, TABLEFLIP, UNFLIP } from '../../hooks/useCommands';

/** The slash commands that change the message being sent, typed at the very start of it. */
type MessageCommand = Extract<
  Command,
  'me' | 'notice' | 'plain' | 'html' | 'shrug' | 'tableflip' | 'unflip'
>;
const MESSAGE_COMMANDS: readonly string[] = [
  'me',
  'notice',
  'plain',
  'html',
  'shrug',
  'tableflip',
  'unflip',
] satisfies MessageCommand[];

const isMessageCommand = (name: string): name is MessageCommand => MESSAGE_COMMANDS.includes(name);

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

/** A `/command` as a word of its own at the start, and the blank space after it. */
const LEADING_COMMAND = /^\/([a-z]+)(?:\s+|$)/;

const isParagraph = (node: Descendant | undefined): node is ParagraphElement =>
  !!node && 'type' in node && node.type === BlockType.Paragraph;

/**
 * Splits a leading message command (`/me`, `/notice`, `/plain`, `/html`, `/shrug`,
 * `/tableflip`, `/unflip`) off the composer's text: the command, and the document without it.
 * Only plain text at the start of the first paragraph counts, so a command inside a code block
 * or a quote is sent as written, and so is any other `/word`.
 */
export const takeMessageCommand = (
  document: Descendant[]
): { command?: MessageCommand; document: Descendant[] } => {
  const asWritten = { document };
  const [firstBlock, ...otherBlocks] = document;
  if (!isParagraph(firstBlock)) return asWritten;
  const [firstRun, ...otherRuns] = firstBlock.children;
  if (!Text.isText(firstRun)) return asWritten;
  const match = LEADING_COMMAND.exec(firstRun.text);
  const command = match?.[1];
  if (!match || !command || !isMessageCommand(command)) return asWritten;
  const rest = { ...firstRun, text: firstRun.text.slice(match[0].length) };
  const paragraph: ParagraphElement = { ...firstBlock, children: [rest, ...otherRuns] };
  return { command, document: [paragraph, ...otherBlocks] };
};

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
 */
export const composeTextMessage = (
  editor: Editor,
  markdown: boolean,
  ownUserId: string | undefined
): IContent | undefined => {
  const { command, document } = takeMessageCommand(editor.children);
  const msgtype = (command && MSGTYPE_BY_COMMAND.get(command)) ?? MsgType.Text;
  const face = command && FACE_BY_COMMAND.get(command);
  // `/plain` and `/html` send what was typed as it is, without reading Markdown in it.
  const readMarkdown = markdown && command !== 'plain' && command !== 'html';
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
