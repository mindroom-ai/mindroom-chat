import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import classNames from 'classnames';
import type { MatrixEvent, Room, RoomMember } from 'matrix-js-sdk';
import { UserAvatar } from '../avatars/UserAvatar';
import { nameInitials } from '../lib/common';
import { describeError } from '../lib/describeError';
import { useAlive } from '../lib/hooks/useAlive';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { matchesEnum } from '../lib/matchesEnum';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { usePowerLevels } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useStateEventCallback } from '../matrix/hooks/useStateEventCallback';
import { getMxIdLocalPart, isUserId } from '../matrix/matrix';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { Membership, StateEvent } from '../matrix/types/room';
import { ownDirectionLine } from '../ui/directional';
import { ErrorDetail } from '../ui/ErrorDetail';
import { getDisplayName } from './invite/InviteUserAutocomplete';
import {
  MODERATOR_LEVEL,
  ModeratorGrantError,
  canOfferModeratorGrant,
  getRawPowerLevels,
  grantRoleName,
  moderatorGrantLevel,
  runRoomModeratorGrant,
  useRoomModeratorGrantState,
} from './invite/moderatorInvite';
import { usePowerLevelTags } from './usePowerLevelTags';
import { useInviteUserSearch } from './useInviteUserSearch';
import type { ServerUserDirectoryUser } from './userDirectoryCache';
import { filterInviteUserCandidates } from './userDirectorySearch';
import * as css from './MembersDrawer.css';

type ModeratorState =
  | { status: 'granting'; level: number }
  | { status: 'granted'; level: number }
  | { status: 'failed'; error: unknown };

type InvitedState = {
  status: 'invited';
  preInviteMembership?: string;
  preInviteMemberEventId?: string;
  seenInviteOrJoin?: boolean;
  moderator?: ModeratorState;
};

type InviteState = { status: 'inviting' } | InvitedState | { status: 'failed'; error: unknown };

/** Someone the section offers: a directory match, or a typed user ID the directory does not list. */
type Candidate = { user: ServerUserDirectoryUser; listed: boolean };

/** An invitation started from the panel, at the row it shows in under the current search. */
type Attempt = Candidate & { index: number; state: InviteState };

type InviteRow = Candidate & { state?: InviteState };

/** The invitations started from the panel, placed for the search they show under. */
type Attempts = { query: string; byUser: Record<string, Attempt> };

const memberEventId = (member: RoomMember | null): string | undefined =>
  member?.events?.member?.getId?.();

/**
 * True when live membership superseded our invite with a leave or ban, without hiding the action
 * merely because the invite (or a re-invite over a pre-invite leave) has not reached local sync.
 */
const isInviteGone = (state: InvitedState, member: RoomMember | null): boolean => {
  const membership = member?.membership;
  if (matchesEnum(membership, Membership.Ban)) return true;
  if (!matchesEnum(membership, Membership.Leave)) return false;
  if (state.seenInviteOrJoin) return true;
  if (!matchesEnum(state.preInviteMembership, Membership.Leave)) return true;
  const currentId = memberEventId(member);
  return (
    state.preInviteMemberEventId !== undefined &&
    currentId !== undefined &&
    currentId !== state.preInviteMemberEventId
  );
};

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
      .filter(
        (attempt) =>
          (attempt.state.status !== 'invited' ||
            attempt.state.moderator?.status === 'granting' ||
            attempt.state.moderator?.status === 'failed') &&
          offered(attempt)
      )
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

function InviteRowItem({
  row,
  canPromote,
  grantLevel,
  roleName,
  grantedRoleName,
  roomGrantInFlight,
  inviteRetired,
  onInvite,
  onMakeModerator,
}: {
  row: InviteRow;
  canPromote: boolean;
  grantLevel: number;
  roleName: string;
  grantedRoleName: (level: number) => string;
  roomGrantInFlight: boolean;
  inviteRetired: boolean;
  onInvite: () => void;
  onMakeModerator: () => void;
}) {
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
  const moderator = state?.status === 'invited' ? state.moderator : undefined;
  const granting = moderator?.status === 'granting';
  const granted = moderator?.status === 'granted';
  const moderatorFailure = moderator?.status === 'failed' ? { error: moderator.error } : undefined;
  const showModerator =
    invited && (granted || (!inviteRetired && (canPromote || moderator !== undefined)));
  const moderatorDisabled = granting || granted || !canPromote || roomGrantInFlight;

  const actionLabel =
    grantLevel > MODERATOR_LEVEL
      ? t('featureUi.room.membersDrawer.makeRole', { role: roleName })
      : t('featureUi.room.membersDrawer.makeModerator');
  const actionAriaLabel =
    grantLevel > MODERATOR_LEVEL
      ? t('featureUi.room.membersDrawer.makeRoleUser', { user: name, role: roleName })
      : t('featureUi.room.membersDrawer.makeModeratorUser', { user: name });

  return (
    <li className={css.InviteRow}>
      <div className={css.InviteRowMain}>
        {/* The name follows; the avatar only decorates the row. */}
        <Avatar className={css.InviteAvatar} size="300" radii="Pill" aria-hidden>
          <UserAvatar
            alt=""
            userId={user.userId}
            src={avatarSrc}
            renderFallback={() => (
              <Text as="span" size="L400">
                {nameInitials(listed ? name : getMxIdLocalPart(user.userId))}
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
            <Text
              as="span"
              id={userIdLine}
              size="T200"
              priority="300"
              truncate
              {...ownDirectionLine}
            >
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
          className={classNames(css.InviteButton, invited && css.InviteSent)}
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
      </div>
      {showModerator && (
        <div className={css.InviteRowModerator}>
          <Button
            size="300"
            variant={granted ? 'Success' : 'Secondary'}
            fill={granted ? 'None' : 'Soft'}
            radii="300"
            className={classNames(css.InviteButton, granted && css.InviteSent)}
            aria-disabled={moderatorDisabled}
            aria-label={granted ? undefined : actionAriaLabel}
            aria-describedby={listed ? userIdLine : undefined}
            onClick={moderatorDisabled ? undefined : onMakeModerator}
            before={
              (granting && <Spinner size="50" variant="Secondary" />) || (
                <Icon size="50" src={Icons.Shield} />
              )
            }
          >
            <Text as="span" size="B300">
              {granted ? grantedRoleName(moderator.level) : actionLabel}
            </Text>
          </Button>
          {moderatorFailure && (
            <Text
              as="span"
              size="T200"
              role="alert"
              style={{ color: color.Critical.Main, overflowWrap: 'anywhere' }}
            >
              {describeError(t, moderatorFailure.error)}
              <ErrorDetail error={moderatorFailure.error} />
            </Text>
          )}
        </div>
      )}
    </li>
  );
}

type InviteListProps = {
  rows: InviteRow[];
  isFetching: boolean;
  canPromote: (userId: string) => boolean;
  grantLevel: number;
  roleName: string;
  grantedRoleName: (level: number) => string;
  roomGrantInFlight: boolean;
  isRowRetired: (row: InviteRow) => boolean;
  onInvite: (row: InviteRow, index: number) => void;
  onMakeModerator: (row: InviteRow) => void;
};

/** The section itself: its title after a line, then the rows, or nothing when there are none. */
function InviteList({
  rows,
  isFetching,
  canPromote,
  grantLevel,
  roleName,
  grantedRoleName,
  roomGrantInFlight,
  isRowRetired,
  onInvite,
  onMakeModerator,
}: InviteListProps) {
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
            <InviteRowItem
              key={row.user.userId}
              row={row}
              canPromote={canPromote(row.user.userId)}
              grantLevel={grantLevel}
              roleName={roleName}
              grantedRoleName={grantedRoleName}
              roomGrantInFlight={roomGrantInFlight}
              inviteRetired={isRowRetired(row)}
              onInvite={() => onInvite(row, index)}
              onMakeModerator={() => onMakeModerator(row)}
            />
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
function InviteSearch({
  room,
  query,
  attempts,
  canPromote,
  grantLevel,
  roleName,
  grantedRoleName,
  roomGrantInFlight,
  isRowRetired,
  onInvite,
  onMakeModerator,
}: InviteSearchProps) {
  const client = useMatrixClient();
  const { suggestions, isFetching } = useInviteUserSearch(room, query);
  const typedUser = isUserId(query)
    ? filterInviteUserCandidates([{ userId: query }], room, client.getSafeUserId())[0]
    : undefined;
  const typed = typedUser ? { user: typedUser, listed: false } : undefined;
  const rows = inviteRows(suggestions, typed, attempts);
  return (
    <InviteList
      rows={rows}
      isFetching={isFetching}
      canPromote={canPromote}
      grantLevel={grantLevel}
      roleName={roleName}
      grantedRoleName={grantedRoleName}
      roomGrantInFlight={roomGrantInFlight}
      isRowRetired={isRowRetired}
      onInvite={onInvite}
      onMakeModerator={onMakeModerator}
    />
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
 * and a complete user ID typed into the search. An invitation still going or failed stays listed
 * when the search changes, also when it is cleared; the directory is searched only for a search.
 * Shows nothing when there is no one to offer.
 */
export function MembersInviteSection({ room, query }: MembersInviteSectionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const levels = usePowerLevels(room);
  const rawLevels = getRawPowerLevels(room);
  const creators = useRoomCreators(room);
  const tags = usePowerLevelTags(room);
  const { inFlight: roomGrantInFlight } = useRoomModeratorGrantState(client, room.roomId);
  const [, refreshMembers] = useForceUpdate();
  const onMemberState = useCallback(
    (event: MatrixEvent) => {
      if (
        event.getRoomId() === room.roomId &&
        matchesEnum(event.getType(), StateEvent.RoomMember)
      ) {
        refreshMembers();
      }
    },
    [room.roomId, refreshMembers]
  );
  useStateEventCallback(client, onMemberState);

  const trimmed = query.trim();
  const [attempts, setAttempts] = useState<Attempts>({ query: trimmed, byUser: {} });
  const [announcement, setAnnouncement] = useState('');
  // A failed invitation drops out once the person joined or was invited some other way.
  const selfUserId = client.getSafeUserId();
  const offered = (attempt: Attempt) =>
    attempt.state.status !== 'failed' ||
    filterInviteUserCandidates([attempt.user], room, selfUserId).length > 0;
  // A new search places the invitations for it, and a failure no longer offered goes for good,
  // before this render shows them. Also note when an invited user reaches invite/join in sync.
  const needsSeenSync = Object.values(attempts.byUser).some((attempt) => {
    if (attempt.state.status !== 'invited' || attempt.state.seenInviteOrJoin) return false;
    const membership = room.getMember(attempt.user.userId)?.membership;
    return matchesEnum(membership, Membership.Invite) || matchesEnum(membership, Membership.Join);
  });
  if (attempts.query !== trimmed) {
    setAttempts({ query: trimmed, byUser: carryOver(attempts.byUser, offered) });
  } else if (!Object.values(attempts.byUser).every(offered) || needsSeenSync) {
    setAttempts({
      query: trimmed,
      byUser: Object.fromEntries(
        Object.entries(attempts.byUser)
          .filter(([, attempt]) => offered(attempt))
          .map(([userId, attempt]) => {
            if (attempt.state.status !== 'invited' || attempt.state.seenInviteOrJoin) {
              return [userId, attempt];
            }
            const membership = room.getMember(userId)?.membership;
            if (
              matchesEnum(membership, Membership.Invite) ||
              matchesEnum(membership, Membership.Join)
            ) {
              return [userId, { ...attempt, state: { ...attempt.state, seenInviteOrJoin: true } }];
            }
            return [userId, attempt];
          })
      ),
    });
  }
  const placed = attempts.query === trimmed ? attempts.byUser : {};

  const updateState = (userId: string, updater: (current: InviteState) => InviteState) =>
    setAttempts((current) => {
      const attempt = current.byUser[userId];
      if (attempt === undefined) return current;
      return {
        ...current,
        byUser: { ...current.byUser, [userId]: { ...attempt, state: updater(attempt.state) } },
      };
    });

  const invite = async ({ user, listed }: InviteRow, index: number) => {
    const beforeMember = room.getMember(user.userId);
    const preInviteMembership = beforeMember?.membership;
    const preInviteMemberEventId = memberEventId(beforeMember);
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
      updateState(user.userId, () => ({
        status: 'invited',
        preInviteMembership,
        preInviteMemberEventId,
      }));
      setAnnouncement(t('sharedUi.inviteUserPrompt.invited', { user: rowName({ user, listed }) }));
    } catch (error) {
      if (alive()) updateState(user.userId, () => ({ status: 'failed', error }));
    }
  };

  const grantLevel = moderatorGrantLevel(levels);
  const roleName = grantRoleName(tags, grantLevel, t);
  const grantedRoleName = (level: number) => grantRoleName(tags, level, t);
  const canPromote = (userId: string) =>
    canOfferModeratorGrant(room, userId, selfUserId, levels, creators, rawLevels);
  const isRowRetired = (row: InviteRow) =>
    row.state?.status === 'invited' && isInviteGone(row.state, room.getMember(row.user.userId));

  const makeModerator = async ({ user, listed, state }: InviteRow) => {
    const name = rowName({ user, listed });
    const invitedSnapshot: InvitedState =
      state?.status === 'invited' ? state : { status: 'invited' };
    updateState(user.userId, (current) =>
      current.status === 'invited'
        ? { ...current, moderator: { status: 'granting', level: grantLevel } }
        : current
    );
    setAnnouncement(
      grantLevel > MODERATOR_LEVEL
        ? t('featureUi.room.membersDrawer.makingRole', { user: name, role: roleName })
        : t('featureUi.room.membersDrawer.makingModerator', { user: name })
    );
    try {
      const result = await runRoomModeratorGrant(client, room, user.userId, {
        isInviteGone: () => isInviteGone(invitedSnapshot, room.getMember(user.userId)),
      });
      if (!alive()) return;
      if (result.status === 'skipped') {
        updateState(user.userId, (current) =>
          current.status === 'invited' ? { ...current, moderator: undefined } : current
        );
        return;
      }
      updateState(user.userId, (current) =>
        current.status === 'invited'
          ? { ...current, moderator: { status: 'granted', level: result.level } }
          : current
      );
      setAnnouncement(
        result.level > MODERATOR_LEVEL
          ? t('featureUi.room.membersDrawer.madeRole', {
              user: name,
              role: grantedRoleName(result.level),
            })
          : t('featureUi.room.membersDrawer.madeModerator', { user: name })
      );
    } catch (error) {
      if (!alive()) return;
      const cause = error instanceof ModeratorGrantError ? error.causeError : error;
      updateState(user.userId, (current) =>
        current.status === 'invited'
          ? { ...current, moderator: { status: 'failed', error: cause } }
          : current
      );
    }
  };

  const onInvite = (row: InviteRow, index: number) => void invite(row, index);
  const onMakeModerator = (row: InviteRow) => void makeModerator(row);

  return (
    <>
      {trimmed === '' ? (
        <InviteList
          rows={inviteRows([], undefined, placed)}
          isFetching={false}
          canPromote={canPromote}
          grantLevel={grantLevel}
          roleName={roleName}
          grantedRoleName={grantedRoleName}
          roomGrantInFlight={roomGrantInFlight}
          isRowRetired={isRowRetired}
          onInvite={onInvite}
          onMakeModerator={onMakeModerator}
        />
      ) : (
        <InviteSearch
          room={room}
          query={trimmed}
          attempts={placed}
          canPromote={canPromote}
          grantLevel={grantLevel}
          roleName={roleName}
          grantedRoleName={grantedRoleName}
          roomGrantInFlight={roomGrantInFlight}
          isRowRetired={isRowRetired}
          onInvite={onInvite}
          onMakeModerator={onMakeModerator}
        />
      )}
      {/* An invitation that went out is said aloud; a failure is an alert in its row. */}
      <p role="status" className={css.VisuallyHidden}>
        {announcement}
      </p>
    </>
  );
}
