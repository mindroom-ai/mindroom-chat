import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { UserAvatar } from '../avatars/UserAvatar';
import { nameInitials } from '../lib/common';
import { describeKnownError, errorDetail } from '../lib/describeError';
import { useAlive } from '../lib/hooks/useAlive';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { isUserId } from '../matrix/matrix';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { ownDirectionLine } from '../ui/directional';
import { getDisplayName } from './invite/InviteUserAutocomplete';
import { useInviteUserSearch } from './useInviteUserSearch';
import type { ServerUserDirectoryUser } from './userDirectoryCache';
import { filterInviteUserCandidates } from './userDirectorySearch';
import * as css from './MembersDrawer.css';

type InviteState =
  | { status: 'inviting' }
  | { status: 'invited' }
  | { status: 'failed'; error: unknown };

/** Someone the section offers: a directory match, or a typed user ID the directory does not list. */
type Candidate = { user: ServerUserDirectoryUser; listed: boolean };

/** An invitation started from the current search, at the row it was started from. */
type Attempt = Candidate & { index: number; state: InviteState };

type InviteRow = Candidate & { state?: InviteState };

/**
 * The rows under the search: the directory's matches, then a typed user ID it did not return.
 * A row that was invited from this search keeps its place, although the search drops people
 * once they are invited, so the list does not move under the pointer.
 */
export const inviteRows = (
  suggestions: readonly ServerUserDirectoryUser[],
  typed: Candidate | undefined,
  attempts: Readonly<Record<string, Attempt>>
): InviteRow[] => {
  const rows: InviteRow[] = suggestions
    .filter((user) => attempts[user.userId] === undefined)
    .map((user) => ({ user, listed: true }));
  const typedId = typed?.user.userId;
  if (
    typed &&
    typedId !== undefined &&
    attempts[typedId] === undefined &&
    !rows.some((row) => row.user.userId === typedId)
  ) {
    rows.push(typed);
  }
  Object.values(attempts)
    .sort((a, b) => a.index - b.index)
    .forEach((attempt) => rows.splice(Math.min(attempt.index, rows.length), 0, attempt));
  return rows;
};

function InviteRowItem({ row, onInvite }: { row: InviteRow; onInvite: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const { user, listed, state } = row;
  const name = listed ? getDisplayName(user) : user.userId;
  const avatarSrc = user.avatarMxcUrl
    ? mxcUrlToHttp(client, user.avatarMxcUrl, authenticatedMedia, 64, 64, 'crop') ?? undefined
    : undefined;
  const failure = state?.status === 'failed' ? state.error : undefined;
  const failureText =
    failure === undefined
      ? undefined
      : describeKnownError(t, failure) ?? errorDetail(failure) ?? t('errors.unknown');

  let detail = listed ? user.userId : t('featureUi.room.membersDrawer.notInDirectory');
  if (failureText !== undefined) detail = failureText;

  return (
    <li className={css.InviteRow}>
      {/* The name follows; the avatar only decorates the row. */}
      <Avatar className={css.InviteAvatar} size="300" radii="Pill" aria-hidden>
        <UserAvatar
          alt=""
          userId={user.userId}
          src={avatarSrc}
          renderFallback={() => (
            <Text as="span" size="L400">
              {nameInitials(name)}
            </Text>
          )}
        />
      </Avatar>
      <span className={css.InviteIdentity}>
        <Text as="span" size="T300" truncate title={name} {...ownDirectionLine}>
          {name}
        </Text>
        <Text
          as="span"
          size="T200"
          priority="300"
          truncate
          role={failureText !== undefined ? 'alert' : undefined}
          title={failure === undefined ? undefined : errorDetail(failure) ?? failureText}
          style={failureText !== undefined ? { color: color.Critical.Main } : undefined}
          {...ownDirectionLine}
        >
          {detail}
        </Text>
      </span>
      {state?.status === 'invited' ? (
        <Text as="span" size="T200" className={css.InviteSent}>
          <Icon size="50" src={Icons.Check} />
          {t('featureUi.room.membersDrawer.inviteSent')}
        </Text>
      ) : (
        <Button
          size="300"
          variant="Primary"
          fill="Soft"
          radii="300"
          className={css.InviteButton}
          disabled={state?.status === 'inviting'}
          aria-label={t('featureUi.room.membersDrawer.inviteUser', { user: name })}
          onClick={onInvite}
          before={
            state?.status === 'inviting' ? (
              <Spinner size="50" variant="Primary" />
            ) : (
              <Icon size="50" src={Icons.Plus} />
            )
          }
        >
          <Text as="span" size="B300">
            {t('featureUi.room.membersDrawer.invite')}
          </Text>
        </Button>
      )}
    </li>
  );
}

type MembersInviteSectionProps = {
  room: Room;
  /** The members panel's search, as typed. */
  query: string;
};

/**
 * Under the members that match the panel's search, the people outside the room who match it, each
 * with an Invite button: the user directory's matches (without anyone joined, invited or banned),
 * and a complete user ID typed into the search. Shows nothing when there is no one to offer.
 */
export function MembersInviteSection({ room, query }: MembersInviteSectionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const headingId = useId();
  const { suggestions, isFetching } = useInviteUserSearch(room, query);
  const [attempts, setAttempts] = useState<{ query: string; byUser: Record<string, Attempt> }>({
    query: '',
    byUser: {},
  });

  const trimmed = query.trim();
  const typedUser = isUserId(trimmed)
    ? filterInviteUserCandidates([{ userId: trimmed }], room, client.getSafeUserId())[0]
    : undefined;
  const typed = typedUser ? { user: typedUser, listed: false } : undefined;
  const rows = inviteRows(suggestions, typed, attempts.query === trimmed ? attempts.byUser : {});

  const setState = (search: string, userId: string, state: InviteState) =>
    setAttempts((current) => {
      const attempt = current.byUser[userId];
      if (current.query !== search || attempt === undefined) return current;
      return { query: search, byUser: { ...current.byUser, [userId]: { ...attempt, state } } };
    });

  const invite = async ({ user, listed }: InviteRow, index: number) => {
    const search = trimmed;
    setAttempts((current) => {
      const byUser = current.query === search ? current.byUser : {};
      const attempt: Attempt = {
        user,
        listed,
        index: byUser[user.userId]?.index ?? index,
        state: { status: 'inviting' },
      };
      return { query: search, byUser: { ...byUser, [user.userId]: attempt } };
    });
    try {
      await client.invite(room.roomId, user.userId);
      if (alive()) setState(search, user.userId, { status: 'invited' });
    } catch (error) {
      if (alive()) setState(search, user.userId, { status: 'failed', error });
    }
  };

  if (rows.length === 0 && !isFetching) return null;

  return (
    <div role="group" aria-labelledby={headingId} className={css.InviteSection}>
      <Text as="h3" id={headingId} size="T200" className={css.InviteSectionTitle}>
        {t('featureUi.room.membersDrawer.notInRoom')}
        {isFetching && rows.length > 0 && <Spinner size="50" variant="Secondary" />}
      </Text>
      {rows.length === 0 ? (
        <Text as="p" size="T200" priority="300" className={css.InviteSearching}>
          {t('sharedUi.inviteUserAutocomplete.searching')}
        </Text>
      ) : (
        <ul className={css.InviteList}>
          {rows.map((row, index) => (
            <InviteRowItem
              key={row.user.userId}
              row={row}
              onInvite={() => void invite(row, index)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
