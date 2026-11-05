import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Transforms } from 'slate';
import { Text } from 'folds';
import { AutocompleteMenu } from '../../editor/autocomplete/AutocompleteMenu';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../../editor/autocomplete/autocompleteQuery';
import { pickOnTab, useAutocompletePick } from '../../editor/autocomplete/useAutocompletePick';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { getCommandSuggestions } from '../slashCommandQuery';
import { MINDROOM_COMMANDS } from './agentCommands';

/** A command the menu can offer. */
export type CommandMenuItem = {
  name: string;
  /** What the command does, in the person's language. */
  description: string;
  /** How to call it, with its arguments; without one the row shows the prefix and the name. */
  syntax?: string;
};

type CommandAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string>;
  /** The menu's heading. */
  title: string;
  /** Every command the menu can offer, in menu order; it lists those starting with what was typed. */
  commands: readonly CommandMenuItem[];
  requestClose: () => void;
};

// A button centers its text; the command starts at the reading edge like other menus, and keeps
// its width on narrow screens, where the description is cut instead (a longer one than the row
// is cut too).
const labelStyle = {
  flexGrow: 1,
  flexShrink: 0,
  maxWidth: '100%',
  fontFamily: 'var(--font-mono)',
  textAlign: 'start',
} as const;

/**
 * The command menu, open while the message's first word starts with a command prefix (`/` or
 * `!`): each command that starts with the typed letters, with what it does. Picking one (click,
 * Tab or Enter) writes the prefix and the name into the composer, ready for the arguments.
 */
export function CommandAutocomplete({
  editor,
  query,
  title,
  commands,
  requestClose,
}: CommandAutocompleteProps) {
  const matching = useMemo(
    () => getCommandSuggestions(commands, query.text),
    [commands, query.text]
  );

  const pick = useCallback(
    ({ name }: CommandMenuItem) => {
      Transforms.select(editor, query.range);
      Editor.insertText(editor, `${query.prefix}${name} `);
      requestClose();
    },
    [editor, query.prefix, query.range, requestClose]
  );

  // The caret stays in the composer, so Tab and Enter there take the first command.
  const hasSuggestions = useAutocompletePick(matching, pick);
  if (!hasSuggestions) return null;

  // Slash command rows carry their name for the browser tests.
  const isSlash = query.prefix === AutocompletePrefix.Command;
  return (
    <AutocompleteMenu requestClose={requestClose} headerContent={<Text size="L400">{title}</Text>}>
      {matching.map((command) => (
        <MenuItem
          key={command.name}
          as="button"
          type="button"
          radii="300"
          data-slash-command={isSlash ? command.name : undefined}
          onKeyDown={pickOnTab(() => pick(command))}
          onClick={() => pick(command)}
          after={
            <Text size="T200" priority="300" truncate>
              {command.description}
            </Text>
          }
        >
          <Text style={labelStyle} size="B400" truncate>
            {command.syntax ?? `${query.prefix}${command.name}`}
          </Text>
        </MenuItem>
      ))}
    </AutocompleteMenu>
  );
}

type AgentCommandAutocompleteProps = Pick<
  CommandAutocompleteProps,
  'editor' | 'query' | 'requestClose'
>;

/** The command menu for MindRoom's `!` commands, which the room's agents answer. */
export function AgentCommandAutocomplete(props: AgentCommandAutocompleteProps) {
  const { t } = useTranslation();
  const commands = useMemo(
    () =>
      MINDROOM_COMMANDS.map(({ name, syntax, description }) => ({
        name,
        syntax,
        // Keys built at runtime are untyped, so t returns unknown.
        description: String(
          t(`mindroomUi.commands.descriptions.${name}`, { defaultValue: description })
        ),
      })),
    [t]
  );
  return (
    <CommandAutocomplete
      {...props}
      title={t('mindroomUi.commands.mindroomCommandAutocomplete.mindroomCommands')}
      commands={commands}
    />
  );
}
