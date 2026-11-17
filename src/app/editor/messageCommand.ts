import { type Descendant, Text } from 'slate';
import type { ParagraphElement } from './slate';
import { BlockType } from './types';

/**
 * The slash commands that change the message being sent, typed at the very start of it. The
 * composer runs them; the composer's styling of typed Markdown reads them the same way.
 */
export const MESSAGE_COMMANDS = [
  'me',
  'notice',
  'plain',
  'html',
  'shrug',
  'tableflip',
  'unflip',
] as const;

export type MessageCommand = (typeof MESSAGE_COMMANDS)[number];

const isMessageCommand = (name: string): name is MessageCommand =>
  (MESSAGE_COMMANDS as readonly string[]).includes(name);

/** Whether a message command sends what was typed as it is, without reading Markdown in it. */
export const sendsAsTyped = (command: MessageCommand | undefined): boolean =>
  command === 'plain' || command === 'html';

/** A `/command` as a word of its own at the start, and the blank space after it. */
const LEADING_COMMAND = /^\/([a-z]+)(?:\s+|$)/;

const isParagraph = (node: Descendant | undefined): node is ParagraphElement =>
  !!node && 'type' in node && node.type === BlockType.Paragraph;

/**
 * The leading message command (`/me`, `/notice`, `/plain`, `/html`, `/shrug`, `/tableflip`,
 * `/unflip`) of the composer's text, and how many characters of the first text it takes: the
 * command and the blank space after it. Only plain text at the start of the first paragraph
 * counts, so a command inside a code block or a quote is sent as written, and so is any other
 * `/word`.
 */
export const findMessageCommand = (
  document: Descendant[]
): { command: MessageCommand; length: number } | undefined => {
  const [firstBlock] = document;
  if (!isParagraph(firstBlock)) return undefined;
  const [firstRun] = firstBlock.children;
  if (!Text.isText(firstRun)) return undefined;
  const match = LEADING_COMMAND.exec(firstRun.text);
  const command = match?.[1];
  if (!match || !command || !isMessageCommand(command)) return undefined;
  return { command, length: match[0].length };
};

/** Splits the leading message command off the composer's text: the command, and the rest. */
export const takeMessageCommand = (
  document: Descendant[]
): { command?: MessageCommand; document: Descendant[] } => {
  const found = findMessageCommand(document);
  const [firstBlock, ...otherBlocks] = document;
  if (!found || !isParagraph(firstBlock)) return { document };
  const [firstRun, ...otherRuns] = firstBlock.children;
  if (!Text.isText(firstRun)) return { document };
  const rest = { ...firstRun, text: firstRun.text.slice(found.length) };
  const paragraph: ParagraphElement = { ...firstBlock, children: [rest, ...otherRuns] };
  return { command: found.command, document: [paragraph, ...otherBlocks] };
};
