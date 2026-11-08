import type { TFunction } from 'i18next';
import { type Descendant, Editor, Range, Text } from 'slate';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../editor/autocomplete/autocompleteQuery';
import { BlockType } from '../editor/types';
import type { CommandRefusal } from './commands/commandRefusal';
import type { SlashCommand } from './commands/useCommands';
import { readableReason } from '../lib/errorReason';

type CommandPrefix = typeof AutocompletePrefix.Command;

/** A `/` word opens the command menu only as the message's first word, where commands go. */
export const isSlashCommandQuery = (
  editor: Editor,
  query: AutocompleteQuery<string> | undefined
): query is AutocompleteQuery<CommandPrefix> => {
  if (query?.prefix !== AutocompletePrefix.Command) return false;
  const before = Editor.string(editor, {
    anchor: Editor.start(editor, []),
    focus: Range.start(query.range),
  });
  return before.trim() === '';
};

/**
 * The commands whose name starts with what was typed after the prefix (`/` or `!`), ignoring
 * case, in their order.
 */
export const getCommandSuggestions = <T extends { name: string }>(
  commands: readonly T[],
  typed: string
): T[] => {
  const start = typed.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(start));
};

/** The composer's text for a command's arguments: a mention pill reads as its Matrix ID. */
const argumentText = (nodes: Descendant[]): string =>
  nodes
    .map((node) => {
      if (Text.isText(node)) return node.text;
      if (node.type === BlockType.Mention) return node.id;
      const inner = argumentText(node.children);
      return node.type === BlockType.Paragraph ? `${inner}\n` : inner;
    })
    .join('');

export type ActingCommand = {
  command: SlashCommand;
  run: (args: string) => Promise<void>;
  args: string;
};

/**
 * The command the composer holds when it is one that acts (`/invite`, `/join`, ...) instead of
 * sending a message, with the text after its name.
 */
export const readActingCommand = (
  document: Descendant[],
  commands: Record<string, SlashCommand>
): ActingCommand | undefined => {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(argumentText(document).trim());
  const command = match?.[1] === undefined ? undefined : commands[match[1]];
  if (!match || !command?.run) return undefined;
  return { command, run: command.run, args: match[2] ?? '' };
};

/**
 * The name of a `/word` the message starts with that is no command, such as `/foobar` or a typo
 * of one; undefined when the message starts with a command or with anything else. As with the
 * commands themselves, only plain text at the start of the first line counts, and a slash
 * followed by more of a path (`/usr/bin`) is no command at all.
 */
export const readUnknownCommand = (
  document: Descendant[],
  commands: Record<string, SlashCommand>
): string | undefined => {
  const [first] = document;
  if (!first || !('type' in first) || first.type !== BlockType.Paragraph) return undefined;
  const [run] = first.children;
  if (!run || !Text.isText(run)) return undefined;
  const name = /^\/([a-z]+)(?:\s|$)/i.exec(run.text)?.[1];
  return name !== undefined && !Object.hasOwn(commands, name) ? name : undefined;
};

/** What the composer says when a command did not run: its usage, or the server's reason. */
export const describeCommandFailure = (
  t: TFunction,
  { command }: ActingCommand,
  error: unknown
): string => {
  const name = `/${command.name}`;
  const refusal = (error as { refusal?: CommandRefusal } | undefined)?.refusal;
  if (refusal?.code === 'usage') {
    return t('featureUi.room.commandAutocomplete.usage', {
      command: name,
      usage: command.description,
    });
  }
  if (refusal?.code === 'ownServer') {
    return t('featureUi.room.commandAutocomplete.ownServer', { server: refusal.server });
  }
  return t('featureUi.room.commandAutocomplete.failed', {
    command: name,
    reason: readableReason(error),
  });
};
