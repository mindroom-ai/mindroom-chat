import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Box, Text, toRem } from 'folds';
import { Editor, Transforms } from 'slate';
import type { Room } from 'matrix-js-sdk';
import { AutocompleteMenu } from './AutocompleteMenu';
import type { AutocompleteQuery } from './autocompleteQuery';
import {
  type EmoticonSuggestion,
  getEmoticonSuggestions,
  readEmoticonQuery,
} from './emoticonSuggestions';
import { createEmoticonElement, moveCursor, replaceWithElement } from '../utils';
import { MenuItem } from '../../glass/GlassPrimitives';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRelevantImagePacks } from '../../../hooks/useImagePacks';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { ImageUsage } from '../../../plugins/custom-emoji';
import { useEmojiData } from '../../../plugins/emojiData';
import { addRecentEmoji } from '../../../plugins/recent-emoji-list';
import { emojiSkinToneAtom } from '../../../state/emojiSkinTone';
import { onTabPress } from '../../../utils/keyboard';
import { mxcUrlToHttp } from '../../../utils/matrix';

/** Where the `:` query sits, whose packs to search, and how the composer hears back. */
type EmoticonAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string>;
  /** The room, its spaces and the server emoji room; their emoji packs are searched too. */
  packRooms: Room[];
  /** Told whether the menu shows anything, so Enter only picks when there is a pick. */
  onSuggestionsChange?: (hasSuggestions: boolean) => void;
  /** Hides the menu once an emoji went in, or when the composer dismisses it. */
  requestClose: () => void;
};

// The glyph or image of a row, in a box as wide as the mention menu's avatars.
const GLYPH_BOX = { width: toRem(24), height: toRem(24), flexShrink: 0 } as const;

function SuggestionGlyph({ suggestion }: { suggestion: EmoticonSuggestion }) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  if (suggestion.kind === 'unicode') {
    return (
      <Box
        as="span"
        alignItems="Center"
        justifyContent="Center"
        aria-hidden
        style={{ ...GLYPH_BOX, fontSize: toRem(20), lineHeight: 1 }}
      >
        {suggestion.key}
      </Box>
    );
  }
  return (
    <img
      src={mxcUrlToHttp(client, suggestion.key, authenticatedMedia, 48, 48, 'scale') ?? undefined}
      alt=""
      style={{ ...GLYPH_BOX, objectFit: 'contain' }}
    />
  );
}

/** One suggestion: the emoji, its `:shortcode:` and, for a custom emoji, its pack. */
function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: EmoticonSuggestion;
  onSelect: (suggestion: EmoticonSuggestion) => void;
}) {
  const [t] = useTranslation();
  let packName: string | undefined;
  if (suggestion.kind === 'custom') {
    packName =
      suggestion.packName ??
      (suggestion.personal ? t('sharedUi.emojiBoard.personalPack') : undefined);
  }
  return (
    <MenuItem
      as="button"
      type="button"
      radii="300"
      before={<SuggestionGlyph suggestion={suggestion} />}
      after={
        packName ? (
          <Text size="T200" priority="300" truncate>
            {packName}
          </Text>
        ) : undefined
      }
      onClick={() => onSelect(suggestion)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) =>
        onTabPress(event, () => {
          // The window listener would insert the first suggestion as well.
          event.stopPropagation();
          onSelect(suggestion);
        })
      }
    >
      <Text size="B400" align="Left" truncate style={{ flexGrow: 1 }}>
        {`:${suggestion.shortcode}:`}
      </Text>
    </MenuItem>
  );
}

/**
 * Suggests emoji for a `:shortcode` being typed: custom emoji from the account's and the room's
 * packs, and Unicode emoji in the chosen skin tone. Tab, Enter or a click inserts the pick.
 */
export function EmoticonAutocomplete(props: EmoticonAutocompleteProps) {
  const { packRooms, editor, query, requestClose, onSuggestionsChange } = props;
  const client = useMatrixClient();
  const [t] = useTranslation();
  const packs = useRelevantImagePacks(ImageUsage.Emoticon, packRooms);
  const tone = useAtomValue(emojiSkinToneAtom);
  // Unicode emoji join the custom ones once the emoji data, asked for by the first query, is in.
  const emojiData = useEmojiData();

  const needle = readEmoticonQuery(query.text);
  const suggestions = useMemo(
    () => (needle ? getEmoticonSuggestions(needle, packs, emojiData?.emojis ?? [], tone) : []),
    [needle, packs, emojiData, tone]
  );

  const hasSuggestions = suggestions.length > 0;
  useEffect(() => {
    onSuggestionsChange?.(hasSuggestions);
  }, [hasSuggestions, onSuggestionsChange]);

  const handleSelect = useCallback(
    (suggestion: EmoticonSuggestion) => {
      if (suggestion.kind === 'custom') {
        replaceWithElement(
          editor,
          query.range,
          createEmoticonElement(suggestion.key, suggestion.shortcode)
        );
      } else {
        Transforms.select(editor, query.range);
        Editor.insertText(editor, suggestion.key);
      }
      moveCursor(editor, true);
      addRecentEmoji(client, suggestion.key).catch(() => undefined);
      requestClose();
    },
    [client, editor, query.range, requestClose]
  );

  const handleKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      onTabPress(evt, () => {
        const [first] = suggestions;
        if (first) handleSelect(first);
      });
    },
    [suggestions, handleSelect]
  );
  useKeyDown(typeof window === 'undefined' || !hasSuggestions ? undefined : window, handleKeyDown);

  if (!hasSuggestions) return null;

  return (
    <AutocompleteMenu
      requestClose={requestClose}
      headerContent={<Text size="L400">{t('sharedUi.emoticonAutocomplete.emojis')}</Text>}
    >
      {suggestions.map((suggestion) => (
        <SuggestionRow
          key={`${suggestion.kind}-${suggestion.key}-${suggestion.shortcode}`}
          suggestion={suggestion}
          onSelect={handleSelect}
        />
      ))}
    </AutocompleteMenu>
  );
}
