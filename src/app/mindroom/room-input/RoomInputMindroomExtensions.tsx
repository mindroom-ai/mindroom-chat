import React from 'react';
import { BaseRange, Editor } from 'slate';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';
import { MindroomCommandAutocomplete } from '../commands/MindroomCommandAutocomplete';
import {
  getMindroomCommandQuery,
  MINDROOM_COMMAND_PREFIX,
} from '../commands/mindroomCommandQuery';
import { VoiceRecorderComposer } from '../voice/VoiceRecorderDialog';

export type MindroomRoomInputAutocompletePrefix = typeof MINDROOM_COMMAND_PREFIX;
export type MindroomRoomInputAutocompleteQuery =
  AutocompleteQuery<MindroomRoomInputAutocompletePrefix>;

type MindroomRoomInputAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string> | undefined;
  requestClose: () => void;
};

export const getMindroomRoomInputAutocompleteQuery = (
  editor: Editor,
  prevWordRange: BaseRange
): MindroomRoomInputAutocompleteQuery | undefined =>
  getMindroomCommandQuery(editor, prevWordRange);

export const isMindroomRoomInputAutocompleteQuery = (
  query: AutocompleteQuery<string> | undefined
): query is MindroomRoomInputAutocompleteQuery => query?.prefix === MINDROOM_COMMAND_PREFIX;

export function MindroomRoomInputAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomRoomInputAutocompleteProps) {
  if (!isMindroomRoomInputAutocompleteQuery(query)) return null;

  return (
    <MindroomCommandAutocomplete editor={editor} query={query} requestClose={requestClose} />
  );
}

export { VoiceRecorderComposer as MindroomVoiceRecorderComposer };
