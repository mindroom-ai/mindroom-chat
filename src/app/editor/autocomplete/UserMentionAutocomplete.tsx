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
import {
  normalizeSearchString,
  rankMatches,
  SEARCH_NOW_SCAN_LIMIT,
  useAsyncSearch,
} from '../../lib/hooks/useAsyncSearch';
import { mxcUrlToHttp } from '../../matrix/matrix';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import {
  memberName,
  mentionRank,
  orderMentionCandidates,
  recentSenders,
} from './mentionRanking';

const MAX_SUGGESTIONS = 20;

/** The mention that notifies everyone in the room (`m.mentions.room`). */
const ROOM_MENTION = '@room';
type Suggestion = RoomMember | typeof ROOM_MENTION;

// Joined and invited members can be mentioned; people who left or were banned are not offered.
const isMentionable = (member: RoomMember): boolean =>
  member.membership === 'join' || member.membership === 'invite';

type UserMentionAutocompleteProps = {
  /**
   * Its members are offered, the ones who spoke last first, and its power levels decide whether
   * `@room` is.
   */
  room: Room;
  /**
   * Called on mount and whenever it changes with whether the menu shows: a query that matches no
   * member shows none, so Enter has no suggestion to pick.
   */
  onSuggestionsChange?: (hasSuggestions: boolean) => void;
  editor: Editor;
  query: AutocompleteQuery<string>;
  /** Closes the menu, after a pick or when the host dismisses it. */
  requestClose: () => void;
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
          <bdi>{member.userId}</bdi>
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

/** The `@room` suggestion: it notifies everyone in the room. */
function RoomMentionRow({ onSelect }: { onSelect: () => void }) {
  const [t] = useTranslation();
  return (
    <MenuItem
      as="button"
      type="button"
      radii="300"
      before={
        <Avatar size="200">
          <Icon size="50" src={Icons.BellRing} />
        </Avatar>
      }
      after={
        <Text size="T200" priority="300" truncate style={{ flex: '1 1 0', textAlign: 'end' }}>
          {t('sharedUi.userMentionAutocomplete.notifyRoom')}
        </Text>
      }
      onClick={onSelect}
      onKeyDown={pickOnTab(onSelect)}
    >
      <Text size="B400" align="Left" truncate style={{ flex: '0 1 auto' }}>
        {ROOM_MENTION}
      </Text>
    </MenuItem>
  );
}

/**
 * Whether a query asks for `@room`: a start of the word `room`. It is offered after the members
 * that match, so Tab or Enter on a short query never notifies the whole room by accident, and
 * first once the whole word is typed.
 */
const asksForRoomMention = (query: string): boolean =>
  query !== '' && 'room'.startsWith(normalizeSearchString(query));

/**
 * Suggests room members for an `@` mention and inserts the chosen one as a mention pill. Someone
 * whose power level may notify the whole room is offered `@room` as well.
 */
export function UserMentionAutocomplete(props: UserMentionAutocompleteProps) {
  const { room, editor, query, requestClose, onSuggestionsChange } = props;
  const client = useMatrixClient();
  const [t] = useTranslation();
  const roomMembers = useRoomMembers(client, room.roomId);
  const members = useMemo(
    () => orderMentionCandidates(roomMembers.filter(isMentionable), recentSenders(room)),
    [roomMembers, room]
  );
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const mayMentionRoom = permissions.notification('room', client.getUserId() ?? '');

  const [result, search, resetSearch] = useAsyncSearch(members, mentionRank);

  const queryText = query.text;
  useEffect(() => {
    if (queryText) search(queryText);
    else resetSearch();
  }, [queryText, search, resetSearch]);

  // The search runs in slices; until it answers, the first members (the last to speak) are
  // ranked right away so Tab can take an obvious match while the user is still typing.
  const memberSuggestions = useMemo(() => {
    if (!queryText) return members.slice(0, MAX_SUGGESTIONS);
    const searched = result && result.query === queryText ? result.items : undefined;
    if (searched && searched.length > 0) return searched.slice(0, MAX_SUGGESTIONS);
    const needle = normalizeSearchString(queryText);
    return rankMatches(members.slice(0, SEARCH_NOW_SCAN_LIMIT), mentionRank, needle).slice(
      0,
      MAX_SUGGESTIONS
    );
  }, [members, queryText, result]);

  const suggestions = useMemo((): Suggestion[] => {
    if (!mayMentionRoom || !asksForRoomMention(queryText)) return memberSuggestions;
    return normalizeSearchString(queryText) === 'room'
      ? [ROOM_MENTION, ...memberSuggestions]
      : [...memberSuggestions, ROOM_MENTION];
  }, [mayMentionRoom, memberSuggestions, queryText]);

  const handleSelect = useCallback(
    (suggestion: Suggestion) => {
      const ownUserId = client.getUserId();
      // "@" and the name, as the timeline shows a mention; the plain body carries it as typed
      // text, which is how MindRoom reads a mention when the message has no mention metadata.
      replaceWithElement(
        editor,
        query.range,
        suggestion === ROOM_MENTION
          ? createMentionElement(ROOM_MENTION, ROOM_MENTION, true)
          : createMentionElement(
              suggestion.userId,
              `@${memberName(suggestion)}`,
              suggestion.userId === ownUserId
            )
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
      {suggestions.map((suggestion) =>
        suggestion === ROOM_MENTION ? (
          <RoomMentionRow key={ROOM_MENTION} onSelect={() => handleSelect(ROOM_MENTION)} />
        ) : (
          <MentionRow key={suggestion.userId} member={suggestion} onSelect={handleSelect} />
        )
      )}
    </AutocompleteMenu>
  );
}
