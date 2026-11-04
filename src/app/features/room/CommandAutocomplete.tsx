import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Transforms } from 'slate';
import { Text } from 'folds';
import { AutocompleteMenu } from '../../components/editor/autocomplete/AutocompleteMenu';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import type { SlashCommand } from '../../hooks/useCommands';
import { useKeyDown } from '../../hooks/useKeyDown';
import { onTabPress } from '../../utils/keyboard';
import { getSlashCommandSuggestions } from '../../mindroom/room-input/slashCommandQuery';

type CommandAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string>;
  commands: Record<string, SlashCommand>;
  requestClose: () => void;
};

// A button centers its text; the command name starts at the reading edge like other menus, and
// keeps its width on narrow screens, where the description is cut instead.
const nameStyle = {
  flexGrow: 1,
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  textAlign: 'start',
} as const;

/**
 * The slash command menu, open while the message's first word starts with `/`: each command
 * that starts with the typed letters, with what it does. Picking one (click, Tab or Enter)
 * writes `/name ` into the composer, ready for its arguments.
 */
export function CommandAutocomplete(props: CommandAutocompleteProps) {
  const { editor, query, commands, requestClose } = props;
  const { t } = useTranslation();
  const matching = useMemo(
    () => getSlashCommandSuggestions(commands, query.text),
    [commands, query.text]
  );

  const pick = useCallback(
    ({ name }: SlashCommand) => {
      Transforms.select(editor, query.range);
      Editor.insertText(editor, `/${name} `);
      requestClose();
    },
    [editor, query.range, requestClose]
  );

  // The caret stays in the composer, so Tab and Enter there take the first command.
  const pickFirstOnKey = useCallback(
    (event: KeyboardEvent) => {
      onTabPress(event, () => {
        const [first] = matching;
        if (first) pick(first);
      });
    },
    [matching, pick]
  );
  useKeyDown(typeof window === 'undefined' ? undefined : window, pickFirstOnKey);

  if (matching.length === 0) return null;

  return (
    <AutocompleteMenu
      requestClose={requestClose}
      headerContent={<Text size="L400">{t('featureUi.room.commandAutocomplete.commands')}</Text>}
    >
      {matching.map((command) => (
        <MenuItem
          key={command.name}
          as="button"
          type="button"
          radii="300"
          data-slash-command={command.name}
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) =>
            onTabPress(event, () => pick(command))
          }
          onClick={() => pick(command)}
          after={
            <Text size="T200" priority="300" truncate>
              {command.description}
            </Text>
          }
        >
          <Text style={nameStyle} size="B400" truncate>
            /{command.name}
          </Text>
        </MenuItem>
      ))}
    </AutocompleteMenu>
  );
}
