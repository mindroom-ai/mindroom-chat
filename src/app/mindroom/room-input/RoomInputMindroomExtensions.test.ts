import { describe, expect, it, vi } from 'vitest';
import { Editor } from 'slate';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../../components/editor/autocomplete/autocompleteQuery';
import {
  getMindroomRoomInputMessageRelation,
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
  MindroomRoomInputThreadIndicator,
} from './RoomInputMindroomExtensions';

vi.mock('../commands/MindroomCommandAutocomplete', () => ({
  MindroomCommandAutocomplete: () => null,
}));

vi.mock('../threads/ThreadIndicator', () => ({
  ThreadIndicator: () => null,
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

  it('builds the MindRoom message relation for plain text sends', () => {
    expect(getMindroomRoomInputMessageRelation(undefined, undefined)).toBeUndefined();

    expect(
      getMindroomRoomInputMessageRelation(
        {
          eventId: '$reply',
          relation: undefined,
        },
        '$thread'
      )
    ).toEqual({
      'm.in_reply_to': { event_id: '$reply' },
      event_id: '$thread',
      rel_type: 'm.thread',
      is_falling_back: false,
    });
  });

  it('renders the thread indicator only for threaded reply drafts', () => {
    expect(
      MindroomRoomInputThreadIndicator({
        room: {} as never,
        relation: undefined,
      })
    ).toBeNull();

    expect(
      MindroomRoomInputThreadIndicator({
        room: {} as never,
        relation: {
          event_id: '$thread',
          rel_type: 'm.thread',
        } as never,
      })
    ).not.toBeNull();
  });
});
