import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon, Icons, Text } from 'folds';
import type { Editor } from 'slate';
import type { Room } from 'matrix-js-sdk';
import { AutocompleteMenu } from './AutocompleteMenu';
import type { AutocompleteQuery } from './autocompleteQuery';
import { createMentionElement, moveCursor, replaceWithElement } from '../utils';
import { MenuItem } from '../../glass/GlassPrimitives';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { onTabPress } from '../../../utils/keyboard';
import { getViaServers } from '../../../plugins/via-servers';
import { Membership } from '../../../../types/matrix/room';

const MAX_SUGGESTIONS = 20;

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

const roomAddress = (room: Room): string => room.getCanonicalAlias() ?? room.roomId;




















  const suggestions = useMemo(
    () =>
      mx
        .getRooms()
        .filter(
          (room) =>
            room.roomId !== roomId &&
            room.getMyMembership() === Membership.Join &&
            (!queryText ||
              normalize(room.name).includes(queryText) ||
              normalize(roomAddress(room)).includes(queryText))
        )
        .slice(0, MAX_SUGGESTIONS),
    [mx, roomId, queryText]
  );

  const handleSelect = useCallback(
    (room: Room) => {
      const name = room.name || t('sharedUi.roomMentionAutocomplete.unknownRoom');
      replaceWithElement(
        editor,
        query.range,
        createMentionElement(roomAddress(room), name, false, undefined, getViaServers(room))
      );
      moveCursor(editor, true);
      requestClose();
    },
    [editor, query.range, requestClose, t]
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
      headerContent={<Text size="L400">{t('sharedUi.roomMentionAutocomplete.rooms')}</Text>}
    >
      {suggestions.map((room) => (
        <MenuItem







              handleSelect(room);
            })
          }
          onClick={() => handleSelect(room)}
          before={
            <Avatar size="200" radii="300">
              <Icon size="50" src={room.isSpaceRoom() ? Icons.Space : Icons.Hash} />
            </Avatar>
          }
          after={
            <Text size="T200" priority="300" truncate>
              {roomAddress(room)}
            </Text>
          }
        >
          <Text style={{ flexGrow: 1 }} size="B400" truncate>
            {room.name || t('sharedUi.roomMentionAutocomplete.unknownRoom')}
          </Text>
        </MenuItem>
      ))}
    </AutocompleteMenu>
  );
}
