import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { UserAvatar } from '../avatars/UserAvatar';
import { nameInitials } from '../lib/common';
import { describeError } from '../lib/describeError';
import { useAlive } from '../lib/hooks/useAlive';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { isUserId } from '../matrix/matrix';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { ownDirectionLine } from '../ui/directional';
import { ErrorDetail } from '../ui/ErrorDetail';
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

/** An invitation started from the panel, at the row it shows in under the current search. */
type Attempt = Candidate & { index: number; state: InviteState };

type InviteRow = Candidate & { state?: InviteState };

/** The invitations started from the panel, placed for the search they show under. */
type Attempts = { query: string; byUser: Record<string, Attempt> };

/**
 * The invitations to keep showing under a new search: those still going and those that failed,
 * at the top in their order, so a failure is never lost while someone types the next name. An
 * invitation that went out showed under the search it was sent from; the header counts it.
 */
const carryOver = (
  byUser: Readonly<Record<string, Attempt>>,
  offered: (attempt: Attempt) => boolean
): Record<string, Attempt> =>
  Object.fromEntries(
    Object.values(byUser)
      .filter((attempt) => attempt.state.status !== 'invited' && offered(attempt))
      .sort((a, b) => a.index - b.index)
      .map((attempt, index) => [attempt.user.userId, { ...attempt, index }])
  );

/**
 * The rows under the search: the directory's matches, then a typed user ID it did not return.
 * An invitation keeps its row in place, although the search drops people once they are invited,
 * so the list does not move under the pointer.
 */
const inviteRows = (
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
  // An attempt shows the directory's current entry for its person when there is one, so a typed
  // user ID gets its name once the directory answers.
  const listedNow = new Map(suggestions.map((user) => [user.userId, user]));
  Object.values(attempts)
    .sort((a, b) => a.index - b.index)
    .forEach((attempt) => {
      const user = listedNow.get(attempt.user.userId);
      const row = user ? { ...attempt, user, listed: true } : attempt;
      rows.splice(Math.min(attempt.index, rows.length), 0, row);
    });
  return rows;
};

/** How a row names its person: the directory's name, or the user ID typed for someone unlisted. */
const rowName = ({ user, listed }: Candidate): string =>
  listed ? getDisplayName(user) : user.userId;

function InviteRowItem({ row, onInvite }: { row: InviteRow; onInvite: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const userIdLine = useId();
  const { user, listed, state } = row;
  const name = rowName(row);
  const avatarSrc = user.avatarMxcUrl
    ? mxcUrlToHttp(client, user.avatarMxcUrl, authenticatedMedia, 64, 64, 'crop') ?? undefined
    : undefined;
  const failure = state?.status === 'failed' ? { error: state.error } : undefined;
  const inviting = state?.status === 'inviting';
  const invited = state?.status === 'invited';

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
        {/* A typed user ID is the name already. */}
        {listed && (
          <Text as="span" id={userIdLine} size="T200" priority="300" truncate {...ownDirectionLine}>
            {user.userId}
          </Text>
        )}
        {/* The whole reason, on as many lines as it takes. */}
        {failure && (
          <Text
            as="span"
            size="T200"
            role="alert"
            style={{ color: color.Critical.Main, overflowWrap: 'anywhere' }}
          >
            {describeError(t, failure.error)}
            <ErrorDetail error={failure.error} />
          </Text>
        )}
      </span>
      {/* One button through every state, so it keeps the keyboard focus once pressed. */}
      <Button
        size="300"
        variant={invited ? 'Success' : 'Primary'}
        fill={invited ? 'None' : 'Soft'}
        radii="300"
        className={css.InviteButton}
        aria-disabled={inviting || invited}
        aria-label={
          invited ? undefined : t('featureUi.room.membersDrawer.inviteUser', { user: name })
        }
        // The user ID under the name tells apart two people of the same name.
        aria-describedby={listed ? userIdLine : undefined}
        onClick={inviting || invited ? undefined : onInvite}
        before={
          (inviting && <Spinner size="50" variant="Primary" />) || (
            <Icon size="50" src={invited ? Icons.Check : Icons.Plus} />
          )
        }
      >
        <Text as="span" size="B300">
          {invited
            ? t('featureUi.room.membersDrawer.inviteSent')
            : t('featureUi.room.membersDrawer.invite')}
        </Text>
      </Button>
    </li>
  );
}

type InviteListProps = {
  rows: InviteRow[];
  isFetching: boolean;
  onInvite: (row: InviteRow, index: number) => void;
};

/** The section itself: its title after a line, then the rows, or nothing when there are none. */
function InviteList({ rows, isFetching, onInvite }: InviteListProps) {
  const { t } = useTranslation();
  const headingId = useId();
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
            <InviteRowItem key={row.user.userId} row={row} onInvite={() => onInvite(row, index)} />
          ))}
        </ul>
      )}
    </div>
  );
}

type InviteSearchProps = Omit<InviteListProps, 'rows' | 'isFetching'> & {
  room: Room;
  query: string;
  attempts: Readonly<Record<string, Attempt>>;
};

/** The directory's matches for a search, with the invitations placed for it. */
function InviteSearch({ room, query, attempts, onInvite }: InviteSearchProps) {
  const client = useMatrixClient();
  const { suggestions, isFetching } = useInviteUserSearch(room, query);
  const typedUser = isUserId(query)
    ? filterInviteUserCandidates([{ userId: query }], room, client.getSafeUserId())[0]
    : undefined;
  const typed = typedUser ? { user: typedUser, listed: false } : undefined;
  const rows = inviteRows(suggestions, typed, attempts);
  return <InviteList rows={rows} isFetching={isFetching} onInvite={onInvite} />;
}

type MembersInviteSectionProps = {
  room: Room;
  /** The members panel's search, as typed. */
  query: string;
};

/**
 * Under the members that match the panel's search, the people outside the room who match it, each
 * with an Invite button: the user directory's matches (without anyone joined, invited or banned),
 * and a complete user ID typed into the search. An invitation still going or failed stays listed
 * when the search changes, also when it is cleared; the directory is searched only for a search.
 * Shows nothing when there is no one to offer.
 */
export function MembersInviteSection({ room, query }: MembersInviteSectionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const trimmed = query.trim();
  const [attempts, setAttempts] = useState<Attempts>({ query: trimmed, byUser: {} });
  const [announcement, setAnnouncement] = useState('');
  // A failed invitation drops out once the person joined or was invited some other way.
  const selfUserId = client.getSafeUserId();
  const offered = (attempt: Attempt) =>
    attempt.state.status !== 'failed' ||
    filterInviteUserCandidates([attempt.user], room, selfUserId).length > 0;
  // A new search places the invitations for it before this render shows them.
  if (attempts.query !== trimmed) {
    setAttempts({ query: trimmed, byUser: carryOver(attempts.byUser, offered) });
  }
  const placed = Object.fromEntries(
    Object.entries(attempts.query === trimmed ? attempts.byUser : {}).filter(([, attempt]) =>
      offered(attempt)
    )
  );

  const setState = (userId: string, state: InviteState) =>
    setAttempts((current) => {
      const attempt = current.byUser[userId];
      if (attempt === undefined) return current;
      return { ...current, byUser: { ...current.byUser, [userId]: { ...attempt, state } } };
    });

  const invite = async ({ user, listed }: InviteRow, index: number) => {
    setAttempts((current) => {
      const attempt: Attempt = {
        user,
        listed,
        index: current.byUser[user.userId]?.index ?? index,
        state: { status: 'inviting' },
      };
      return { ...current, byUser: { ...current.byUser, [user.userId]: attempt } };
    });
    try {
      await client.invite(room.roomId, user.userId);
      if (!alive()) return;
      setState(user.userId, { status: 'invited' });
      setAnnouncement(t('sharedUi.inviteUserPrompt.invited', { user: rowName({ user, listed }) }));
    } catch (error) {
      if (alive()) setState(user.userId, { status: 'failed', error });
    }
  };
  const onInvite = (row: InviteRow, index: number) => void invite(row, index);

  return (
    <>
      {trimmed === '' ? (
        <InviteList
          rows={inviteRows([], undefined, placed)}
          isFetching={false}
          onInvite={onInvite}
        />
      ) : (
        <InviteSearch room={room} query={trimmed} attempts={placed} onInvite={onInvite} />
      )}
      {/* An invitation that went out is said aloud; a failure is an alert in its row. */}
      <p role="status" className={css.VisuallyHidden}>
        {announcement}
      </p>
    </>
  );
}
