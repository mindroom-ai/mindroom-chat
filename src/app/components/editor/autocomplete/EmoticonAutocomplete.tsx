import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Text } from 'folds';
import type { Editor } from 'slate';
import type { Room } from 'matrix-js-sdk';
import { AutocompleteMenu } from './AutocompleteMenu';
import type { AutocompleteQuery } from './autocompleteQuery';
import { createEmoticonElement, moveCursor, replaceWithElement } from '../utils';
import { MenuItem } from '../../glass/GlassPrimitives';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRelevantImagePacks } from '../../../hooks/useImagePacks';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { onTabPress } from '../../../utils/keyboard';
import { mxcUrlToHttp } from '../../../utils/mediaUrl';
import { emojis } from '../../../plugins/emoji';
import { ImageUsage } from '../../../plugins/custom-emoji/types';

const MAX_SUGGESTIONS = 20;

type EmoticonSuggestion = {
  /** Unicode emoji, or the mxc URI of a custom emoji. */
  key: string;
  shortcode: string;










/** Suggests emoji for a `:shortcode` and inserts the chosen one. */









  const packs = useRelevantImagePacks(ImageUsage.Emoticon, imagePackRooms);
  const needle = query.text.toLocaleLowerCase();

  const suggestions = useMemo<EmoticonSuggestion[]>(() => {
    if (!needle) return [];
    const custom = packs.flatMap((pack) =>
      pack
        .getImages(ImageUsage.Emoticon)
        .filter((image) => image.shortcode.toLocaleLowerCase().includes(needle))
        .map((image) => ({ key: image.url, shortcode: image.shortcode }))
    );
    const unicode = emojis
      .filter((emoji) => emoji.shortcodes.some((shortcode) => shortcode.includes(needle)))
      .map((emoji) => ({ key: emoji.unicode, shortcode: emoji.shortcode }));
    return [...custom, ...unicode].slice(0, MAX_SUGGESTIONS);
  }, [needle, packs]);

  const handleSelect = useCallback(
    (suggestion: EmoticonSuggestion) => {
      replaceWithElement(
        editor,
        query.range,
        createEmoticonElement(suggestion.key, suggestion.shortcode)
      );
      moveCursor(editor);
      requestClose();
    },
    [editor, query.range, requestClose]
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
  useKeyDown(typeof window === 'undefined' ? undefined : window, handleKeyDown);

  if (suggestions.length === 0) return null;

  return (
    <AutocompleteMenu
      requestClose={requestClose}
      headerContent={<Text size="L400">{t('sharedUi.emoticonAutocomplete.emojis')}</Text>}
    >
      {suggestions.map((suggestion) => {
        const custom = suggestion.key.startsWith('mxc://');
        const src = custom
          ? mxcUrlToHttp(mx, suggestion.key, useAuthentication, 32, 32, 'scale') ?? undefined
          : undefined;
        return (
          <MenuItem
            key={`${suggestion.key}:${suggestion.shortcode}`}
            as="button"
            type="button"
            radii="300"



                handleSelect(suggestion);
              })
            }
            onClick={() => handleSelect(suggestion)}
            before={
              <Box
                as="span"
                shrink="No"
                justifyContent="Center"
                alignItems="Center"
                style={{ width: '1.5rem', height: '1.5rem', fontSize: '1.25rem' }}
              >
                {src ? (
                  <img src={src} alt={suggestion.shortcode} style={{ height: '1.5rem' }} />
                ) : (
                  suggestion.key
                )}
              </Box>
            }
          >
            <Text style={{ flexGrow: 1 }} size="B400" truncate>
              :{suggestion.shortcode}:
            </Text>
          </MenuItem>
        );
      })}
    </AutocompleteMenu>
  );
}
