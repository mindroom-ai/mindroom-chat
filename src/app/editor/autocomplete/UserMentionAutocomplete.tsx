import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon, Icons, Text } from 'folds';
import type { Editor } from 'slate';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { AutocompleteMenu } from './AutocompleteMenu';
import type { AutocompleteQuery } from './autocompleteQuery';
import { pickOnTab, useAutocompletePick } from './useAutocompletePick';
import { createMentionElement, moveCursor, replaceWithElement } from '../utils';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { SEARCH_NOW_SCAN_LIMIT, useAsyncSearch } from '../../lib/hooks/useAsyncSearch';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../matrix/matrix';

const MAX_SUGGESTIONS = 20;

const memberName = (member: RoomMember): string =>
  member.rawDisplayName || member.name || getMxIdLocalPart(member.userId) || member.userId;

/**
 * The strings a member is found by: display name and the user name in their ID. The server
 * name is left out, since most members share it and every query would match it.
 */
const getMemberSearchStrings = (member: RoomMember): string[] => [
  memberName(member),
  getMxIdLocalPart(member.userId) ?? member.userId,
];

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

const memberMatches = (member: RoomMember, query: string): boolean => {
  const needle = normalize(query);
  return getMemberSearchStrings(member).some((value) => normalize(value).includes(needle));
};

// Joined and invited members can be mentioned; people who left or were banned are not offered.
const isMentionable = (member: RoomMember): boolean =>
  member.membership === 'join' || member.membership === 'invite';

type UserMentionAutocompleteProps = {
  /** Only the room ID is read. */
  room: Pick<Room, 'roomId'>;
  editor: Editor;
  query: AutocompleteQuery<string>;
  /** Closes the menu, after a pick or when the host dismisses it. */
  requestClose: () => void;
  /**
   * Called on mount and whenever it changes with whether the menu shows: a query that matches no
   * member shows none, so Enter has no suggestion to pick.
   */
  onSuggestionsChange?: (hasSuggestions: boolean) => void;
};

const renderFallbackAvatar = () => <Icon size="50" src={Icons.User} filled />;

/** One suggestion: avatar, name and user ID. A click, Tab or Enter picks it. */
function MentionRow({
  member,
  onSelect,
}: {
  member: RoomMember;
  onSelect: (member: RoomMember) => void;
}) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const displayName = memberName(member);
  const avatarMxc = member.getMxcAvatarUrl();
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticatedMedia, 32, 32, 'crop') ?? undefined
    : undefined;
  const avatar = (
    <Avatar size="200">
      <UserAvatar
        userId={member.userId}
        src={avatarSrc}
        alt={displayName}
        renderFallback={renderFallbackAvatar}
      />
    </Avatar>
  );

  return (
    <MenuItem
      as="button"
      type="button"
      radii="300"
      before={avatar}
      after={
        // The ID takes only the room the name leaves: on a phone a long ID would otherwise cut
        // the name short.
        <Text size="T200" priority="300" truncate style={{ flex: '1 1 0', textAlign: 'end' }}>
          {member.userId}
        </Text>
      }
      onClick={() => onSelect(member)}
      onKeyDown={pickOnTab(() => onSelect(member))}
    >
      <Text size="B400" align="Left" truncate style={{ flex: '0 1 auto' }}>
        {displayName}
      </Text>
    </MenuItem>
  );
}

/** Suggests room members for an `@` mention and inserts the chosen one as a mention pill. */
export function UserMentionAutocomplete(props: UserMentionAutocompleteProps) {
  const { room, editor, query, requestClose, onSuggestionsChange } = props;
  const client = useMatrixClient();
  const [t] = useTranslation();
  const roomMembers = useRoomMembers(client, room.roomId);
  const members = useMemo(() => roomMembers.filter(isMentionable), [roomMembers]);

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
      const ownUserId = client.getUserId();
      replaceWithElement(
        editor,
        query.range,
        createMentionElement(member.userId, memberName(member), member.userId === ownUserId)
      );
      moveCursor(editor, true);
      requestClose();
    },
    [client, editor, query.range, requestClose]
  );

  const hasSuggestions = useAutocompletePick(suggestions, handleSelect, onSuggestionsChange);

  if (!hasSuggestions) return null;

  return (
    <AutocompleteMenu
      requestClose={requestClose}
      headerContent={<Text size="L400">{t('sharedUi.userMentionAutocomplete.mentions')}</Text>}
    >
      {suggestions.map((member) => (
        <MentionRow key={member.userId} member={member} onSelect={handleSelect} />
      ))}
    </AutocompleteMenu>
  );
}
