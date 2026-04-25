import { describe, expect, it, vi } from 'vitest';
import { Editor } from 'slate';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../../components/editor/autocomplete/autocompleteQuery';
import {
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
} from './RoomInputMindroomExtensions';

vi.mock('../commands/MindroomCommandAutocomplete', () => ({
  MindroomCommandAutocomplete: () => null,
}));

const range = {
  anchor: { path: [0, 0], offset: 0 },
  focus: { path: [0, 0], offset: 1 },
};

const query = (prefix: string): AutocompleteQuery<string> => ({
  range,
  prefix,
  text: '',
});

describe('RoomInputMindroomExtensions', () => {
  it('recognizes only MindRoom room-input autocomplete queries', () => {
    expect(isMindroomRoomInputAutocompleteQuery(query('!'))).toBe(true);
    expect(isMindroomRoomInputAutocompleteQuery(query(AutocompletePrefix.Command))).toBe(false);
    expect(isMindroomRoomInputAutocompleteQuery(undefined)).toBe(false);
  });

  it('does not render MindRoom autocomplete for upstream room-input queries', () => {
    expect(
      MindroomRoomInputAutocomplete({
        editor: {} as Editor,
        query: query(AutocompletePrefix.Command),
        requestClose: () => undefined,
      })
    ).toBeNull();
  });
});
