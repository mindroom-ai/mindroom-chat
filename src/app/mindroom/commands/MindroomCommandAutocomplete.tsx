import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from 'slate';
import { Text } from 'folds';
import { AutocompleteMenu } from '../../components/editor/autocomplete/AutocompleteMenu';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { useKeyDown } from '../../hooks/useKeyDown';
import { onTabPress } from '../../utils/keyboard';
import { insertMindroomCommand } from './mindroomCommandQuery';
import { MINDROOM_COMMANDS, type MindroomCommandItem } from './mindroomCommands';

type MindroomCommandAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
};

const matches = (command: MindroomCommandItem, text: string): boolean =>
  command.name.toLowerCase().startsWith(text.toLowerCase());

/** Suggests MindRoom's `!` commands while the message starts with one, with their syntax. */
export function MindroomCommandAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomCommandAutocompleteProps) {
  const { t } = useTranslation();
  const suggestions = useMemo(
    () => MINDROOM_COMMANDS.filter((command) => matches(command, query.text)),
    [query.text]
  );

  const select = useCallback(
    (command: MindroomCommandItem) => {
      insertMindroomCommand(editor, query.range, command.name);
      requestClose();
    },
    [editor, query.range, requestClose]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      onTabPress(event, () => {
        const [first] = suggestions;
        if (first) select(first);
      });
    },
    [select, suggestions]
  );
  useKeyDown(typeof window === 'undefined' ? undefined : window, handleKeyDown);

  if (suggestions.length === 0) return null;

  return (
    <AutocompleteMenu
      requestClose={requestClose}
      headerContent={<Text size="L400">{t('mindroomUi.commands.title')}</Text>}
    >
      {suggestions.map((command) => (
        <MenuItem
          key={command.name}
          as="button"
          type="button"
          radii="300"
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) =>
            onTabPress(event, () => select(command))
          }
          onClick={() => select(command)}
          after={
            <Text size="T200" priority="300" truncate>
              {t(`mindroomUi.commands.descriptions.${command.name}`, {
                defaultValue: command.description,
              })}
            </Text>
          }
        >
          <Text style={{ flexGrow: 1, fontFamily: 'var(--font-mono)' }} size="B400" truncate>
            {command.syntax}
          </Text>
        </MenuItem>
      ))}
    </AutocompleteMenu>
  );
}
