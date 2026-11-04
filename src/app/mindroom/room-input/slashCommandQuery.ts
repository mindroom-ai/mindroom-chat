import type { TFunction } from 'i18next';
import { type Descendant, Editor, Range, Text } from 'slate';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../../components/editor/autocomplete/autocompleteQuery';
import { BlockType } from '../../components/editor/types';
import type { CommandRefusal, SlashCommand } from '../../hooks/useCommands';
import { readableReason } from '../../utils/errorReason';

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

/** The commands whose name starts with what was typed after the `/`. */
export const getSlashCommandSuggestions = (
  commands: Record<string, SlashCommand>,
  typed: string
): SlashCommand[] => {
  const start = typed.toLowerCase();
  return Object.values(commands).filter((command) => command.name.startsWith(start));
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
