import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect } from 'react';
import { Editor } from 'slate';
import { Box, config, MenuItem, Text } from 'folds';
import {
  AutocompleteMenu,
  AutocompleteQuery,
  moveCursor,
} from '../../components/editor';
import { insertMindroomCommand } from './mindroomCommandQuery';
import { UseAsyncSearchOptions, useAsyncSearch } from '../../hooks/useAsyncSearch';
import { useKeyDown } from '../../hooks/useKeyDown';
import { onTabPress } from '../../utils/keyboard';
import { MINDROOM_COMMANDS, MindroomCommandItem } from './mindroomCommands';

type MindroomCommandAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
};

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: {
    contain: true,
  },
};

export function MindroomCommandAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomCommandAutocompleteProps) {
  const [result, search, resetSearch] = useAsyncSearch(
    MINDROOM_COMMANDS,
    useCallback((item: MindroomCommandItem) => item.name, []),
    SEARCH_OPTIONS
  );

  useEffect(() => {
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, search, resetSearch]);

  const commands = result ? result.items : MINDROOM_COMMANDS;

  const handleAutocomplete = (command: MindroomCommandItem) => {
    insertMindroomCommand(editor, query.range, command.name);
    moveCursor(editor, true);
    requestClose();
  };

  useKeyDown(window, (evt: KeyboardEvent) => {
    onTabPress(evt, () => {
      if (commands.length === 0) return;
      handleAutocomplete(commands[0]);
    });
  });

  return commands.length === 0 ? null : (
    <AutocompleteMenu
      headerContent={
        <Box grow="Yes" direction="Row" gap="200" justifyContent="SpaceBetween">
          <Text size="L400">MindRoom Commands</Text>
        </Box>
      }
      requestClose={requestClose}
    >
      {commands.map((command) => (
        <MenuItem
          key={command.name}
          as="button"
          radii="300"
          style={{ height: 'unset' }}
          onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
            onTabPress(evt, () => handleAutocomplete(command))
          }
          onClick={() => handleAutocomplete(command)}
        >
          <Box
            style={{ padding: `${config.space.S300} 0` }}
            grow="Yes"
            direction="Column"
            gap="100"
            justifyContent="SpaceBetween"
          >
            <Text style={{ flexGrow: 1 }} size="B400" truncate>
              {command.syntax}
            </Text>
            <Text truncate priority="300" size="T200">
              {command.description}
            </Text>
          </Box>
        </MenuItem>
      ))}
    </AutocompleteMenu>
  );
}
