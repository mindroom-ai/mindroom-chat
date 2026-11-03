import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon, Icons, Text } from 'folds';
import type { Editor } from 'slate';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { AutocompleteMenu } from './AutocompleteMenu';
import type { AutocompleteQuery } from './autocompleteQuery';
import { createMentionElement, moveCursor, replaceWithElement } from '../utils';
import { MenuItem } from '../../glass/GlassPrimitives';
import { UserAvatar } from '../../user-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRoomMembers } from '../../../hooks/useRoomMembers';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { SEARCH_NOW_SCAN_LIMIT, useAsyncSearch } from '../../../hooks/useAsyncSearch';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { onTabPress } from '../../../utils/keyboard';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';

const MAX_SUGGESTIONS = 20;

const memberName = (member: RoomMember): string =>
  member.rawDisplayName || member.name || getMxIdLocalPart(member.userId) || member.userId;

/** The strings a member is found by: display name and user ID. */
const getMemberSearchStrings = (member: RoomMember): string[] => [
  memberName(member),
  member.userId,
];

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

const memberMatches = (member: RoomMember, query: string): boolean => {
  const needle = normalize(query);
  return getMemberSearchStrings(member).some((value) => normalize(value).includes(needle));
};






};

/** Suggests room members for an `@` mention and inserts the chosen one as a mention pill. */











  const [result, search, resetSearch] = useAsyncSearch(members, getMemberSearchStrings);

  const queryText = query.text;
  useEffect(() => {
    if (queryText) search(queryText);
    else resetSearch();
  }, [queryText, search, resetSearch]);

  // The search runs in slices; until it answers, the first members are scanned right away so
  // Tab can take an obvious match while the user is still typing.
  const suggestions = useMemo(() => {
    if (!queryText) return members.slice(0, MAX_SUGGESTIONS);
    const searched = result && result.query === queryText ? result.items : undefined;
    if (searched && searched.length > 0) return searched.slice(0, MAX_SUGGESTIONS);
    return members
      .slice(0, SEARCH_NOW_SCAN_LIMIT)
      .filter((member) => memberMatches(member, queryText))
      .slice(0, MAX_SUGGESTIONS);
  }, [members, queryText, result]);

  const handleSelect = useCallback(
    (member: RoomMember) => {
      const ownUserId = mx.getUserId();
      replaceWithElement(
        editor,
        query.range,
        createMentionElement(member.userId, memberName(member), member.userId === ownUserId)
      );
      moveCursor(editor, true);
      requestClose();
    },
    [mx, editor, query.range, requestClose]
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
      headerContent={<Text size="L400">{t('sharedUi.userMentionAutocomplete.mentions')}</Text>}
    >
      {suggestions.map((member) => {
        const name = memberName(member);
        const avatarMxc = member.getMxcAvatarUrl();
        const avatarUrl = avatarMxc
          ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 32, 32, 'crop') ?? undefined
          : undefined;
        return (
          <MenuItem
            key={member.userId}
            as="button"
            type="button"
            radii="300"
            onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
              onTabPress(evt, () => handleSelect(member))
            }
            onClick={() => handleSelect(member)}

















              {name}
            </Text>
          </MenuItem>
        );
      })}
    </AutocompleteMenu>
  );
}
