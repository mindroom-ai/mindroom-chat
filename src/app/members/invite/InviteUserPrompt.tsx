import {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Chip,
  Icon,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import {
  KnownMembership,
  RoomMemberEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import { Dialog, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { UserAvatar } from '../../avatars/UserAvatar';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { ownDirectionLine } from '../../ui/directional';
import { nameInitials } from '../../lib/common';
import { describeError } from '../../lib/describeError';
import { useAlive } from '../../lib/hooks/useAlive';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { stopPropagation } from '../../lib/keyboard';
import { useDirectUsers } from '../../matrix/hooks/useDirectUsers';
import { useLoadedRoomMembers } from '../../matrix/hooks/useLoadedRoomMembers';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getMxIdLocalPart, isUserId } from '../../matrix/matrix';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import {
  isMindroomAgentUserId,
  isMindroomAgentUserIdForViewer,
} from '../../matrix/protocol/agentIdentity';
import { usePowerLevelTags } from '../usePowerLevelTags';
import { useInviteUserSearch } from '../useInviteUserSearch';
import { useUserDirectoryCache } from '../useUserDirectoryCache';
import { mergeUserDirectoryUsers, type ServerUserDirectoryUser } from '../userDirectoryCache';
import { filterInviteUserCandidates } from '../userDirectorySearch';
import { getDisplayName } from './InviteUserAutocomplete';
import {
  detachedGrantErrorAtom,
  evaluateModeratorGrant,
  evaluateRoomModeratorGrant,
  formatGrantFailure,
  grantRoleName,
  grantRoomModeratorRights,
  hasModeratorMindroomAgent,
} from './moderatorInvite';
import * as modalCss from '../../ui/Modal500.css';
import * as css from './InviteUserPrompt.css';

type InviteUserPromptProps = {
  room: Room;
  requestClose: () => void;
};

type InviteFilter = 'all' | 'people' | 'agents';
type RowSection = 'direct' | 'directory' | 'search';

type AttemptState =
  | { status: 'inviting' }
  | { status: 'invited' }
  | { status: 'failed'; error: unknown }
  | { status: 'grantFailed'; message: string };

type Candidate = {
  user: ServerUserDirectoryUser;
  listed: boolean;
  section: RowSection;
};

type Attempt = Candidate & {
  index: number;
  state: AttemptState;
};

type InviteRow = Candidate & {
  state?: AttemptState;
};

type Attempts = {
  viewKey: string;
  byUser: Record<string, Attempt>;
};

const TITLE_ID = 'invite-user-prompt-title';
const ROW_ACTION_ATTRIBUTE = 'data-invite-row-action';
const BROWSE_DIRECTORY_LIMIT = 100;
const FILTERS: readonly InviteFilter[] = ['all', 'people', 'agents'];

const FILTER_LABEL_KEY: Record<
  InviteFilter,
  | 'sharedUi.inviteUserPrompt.filterAll'
  | 'sharedUi.inviteUserPrompt.filterPeople'
  | 'sharedUi.inviteUserPrompt.filterAgents'
> = {
  all: 'sharedUi.inviteUserPrompt.filterAll',
  people: 'sharedUi.inviteUserPrompt.filterPeople',
  agents: 'sharedUi.inviteUserPrompt.filterAgents',
};

const isAgentCandidate = (userId: string, viewerId: string | undefined): boolean =>
  viewerId ? isMindroomAgentUserIdForViewer(userId, viewerId) : isMindroomAgentUserId(userId);

const matchesFilter = (
  userId: string,
  filter: InviteFilter,
  viewerId: string | undefined
): boolean => {
  if (filter === 'all') return true;
  const isAgent = isAgentCandidate(userId, viewerId);
  return filter === 'agents' ? isAgent : !isAgent;
};

const compareBrowseUsers = (a: ServerUserDirectoryUser, b: ServerUserDirectoryUser): number =>
  getDisplayName(a).localeCompare(getDisplayName(b), undefined, { sensitivity: 'base' }) ||
  a.userId.localeCompare(b.userId);

const rowDisplayName = ({ user, listed }: Pick<Candidate, 'user' | 'listed'>): string =>
  listed ? getDisplayName(user) : user.userId;

/**
 * Keeps in-flight invites, failed invites, and grant failures across query/filter changes so
 * actionable feedback is never lost. Clean completed invites stay in their original view and
 * drop out once the user moves to another search or tab.
 */
const carryOver = (
  byUser: Readonly<Record<string, Attempt>>,
  offered: (attempt: Attempt) => boolean
): Record<string, Attempt> =>
  Object.fromEntries(
    Object.values(byUser)
      .filter((attempt) => attempt.state.status !== 'invited' && offered(attempt))
      .sort((a, b) => a.index - b.index)
      .map((attempt, index) => [attempt.user.userId, { ...attempt, section: 'search', index }])
  );

/** Splices attempts back into their original positions so rows never jump when membership syncs. */
const mergeAttemptsIntoRows = (
  candidates: readonly Candidate[],
  attempts: readonly Attempt[],
  knownUsers?: ReadonlyMap<string, ServerUserDirectoryUser>
): InviteRow[] => {
  const attemptIds = new Set(attempts.map((attempt) => attempt.user.userId));
  const rows: InviteRow[] = candidates.filter(
    (candidate) => !attemptIds.has(candidate.user.userId)
  );
  [...attempts]
    .sort((a, b) => a.index - b.index)
    .forEach((attempt) => {
      const listedUser = knownUsers?.get(attempt.user.userId);
      const row: InviteRow = listedUser ? { ...attempt, user: listedUser, listed: true } : attempt;
      rows.splice(Math.min(attempt.index, rows.length), 0, row);
    });
  return rows;
};

/** Moves focus between the search input and each row's action button. */
const moveFocus = (container: HTMLElement | null, field: HTMLElement | null, step: 1 | -1) => {
  const actions = [
    ...(container?.querySelectorAll<HTMLElement>(`[${ROW_ACTION_ATTRIBUTE}]`) ?? []),
  ];
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const current = actions.findIndex((action) => action === active);
  const next = current + step;
  if (next < 0) field?.focus();
  else actions[Math.min(next, actions.length - 1)]?.focus();
};

const dialogTrapOptions = (
  firstFocus: RefObject<HTMLElement>,
  dismiss: () => void
): FocusTrap.Props['focusTrapOptions'] => ({
  initialFocus: () => firstFocus.current ?? false,
  onDeactivate: dismiss,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
});

function InviteDirectoryRow({
  row,
  viewerId,
  onInvite,
}: {
  row: InviteRow;
  viewerId: string | undefined;
  onInvite: () => void;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const subtitleId = useId();
  const { user, listed, state } = row;
  const name = rowDisplayName(row);
  const isAgent = isAgentCandidate(user.userId, viewerId);
  const avatarSrc = user.avatarMxcUrl
    ? mxcUrlToHttp(client, user.avatarMxcUrl, authenticatedMedia, 64, 64, 'crop') ?? undefined
    : undefined;
  const inviting = state?.status === 'inviting';
  const sent = state?.status === 'invited' || state?.status === 'grantFailed';
  const failed = state?.status === 'failed';

  let variant: 'Primary' | 'Success' | 'Critical' = 'Primary';
  let fill: 'Soft' | 'None' = 'Soft';
  let before: ReactNode = <Icon size="50" src={Icons.Plus} />;
  let buttonLabel = t('featureUi.room.membersDrawer.invite');
  let ariaLabel: string | undefined = t('featureUi.room.membersDrawer.inviteUser', { user: name });

  if (inviting) {
    before = <Spinner size="50" variant="Primary" />;
  } else if (sent) {
    variant = 'Success';
    fill = 'None';
    before = <Icon size="50" src={Icons.Check} />;
    buttonLabel = t('featureUi.room.membersDrawer.inviteSent');
    ariaLabel = undefined;
  } else if (failed) {
    variant = 'Critical';
    fill = 'Soft';
    before = undefined;
    buttonLabel = t('sharedUi.roomCard.retry');
    ariaLabel = undefined;
  }

  return (
    <li className={css.Row}>
      <Avatar className={css.AvatarWrap} size="300" radii={isAgent ? '300' : 'Pill'} aria-hidden>
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
      <div className={css.Identity}>
        <div className={css.NameLine}>
          <Text as="span" size="T300" truncate title={name} {...ownDirectionLine}>
            {name}
          </Text>
          {isAgent && (
            <Badge variant="Primary" fill="Soft" radii="300" className={css.AgentBadge}>
              <Text as="span" size="L400">
                {t('sharedUi.agentCard.agent')}
              </Text>
            </Badge>
          )}
        </div>
        <Text
          as="span"
          id={subtitleId}
          size="T200"
          priority="300"
          truncate
          title={user.userId}
          {...ownDirectionLine}
        >
          {listed ? user.userId : t('sharedUi.inviteUserPrompt.externalUserId')}
        </Text>
        {state?.status === 'failed' && (
          <Text as="span" size="T200" role="alert" className={css.RowError}>
            {describeError(t, state.error)}
            <ErrorDetail error={state.error} />
          </Text>
        )}
        {state?.status === 'grantFailed' && (
          <Text as="span" size="T200" role="alert" className={css.RowError}>
            {state.message}
          </Text>
        )}
      </div>
      <Button
        type="button"
        size="300"
        variant={variant}
        fill={fill}
        radii="300"
        className={classNames(css.RowAction, sent && css.RowActionSent)}
        {...{ [ROW_ACTION_ATTRIBUTE]: '' }}
        aria-disabled={inviting || sent}
        aria-label={ariaLabel}
        aria-describedby={subtitleId}
        onClick={inviting || sent ? undefined : onInvite}
        before={before}
      >
        <Text as="span" size="B300">
          {buttonLabel}
        </Text>
      </Button>
    </li>
  );
}

/**
 * Instant Directory Sheet for inviting people and agents to a room. Opens directly onto a
 * browsable, filterable directory with one-tap per-row invites, inline search, Enter-to-invite
 * for full Matrix User IDs, collapsible invite note, and room-level agent moderator rights.
 */
export function InviteUserPrompt({ room, requestClose }: InviteUserPromptProps) {
  const { t } = useTranslation();
  const noteInputId = useId();
  const moderatorHelpId = useId();
  const directHeadingId = useId();
  const directoryHeadingId = useId();
  const store = useStore();
  const client = useMatrixClient();
  const alive = useAlive();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const levels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const tags = usePowerLevelTags(room);
  const me = client.getSafeUserId();
  const cache = useUserDirectoryCache();
  const directUsers = useDirectUsers();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(new Set<string>());

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InviteFilter>('all');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [grantOverride, setGrantOverride] = useState<boolean>();
  const [announcement, setAnnouncement] = useState('');
  const [sessionInvitedIds, setSessionInvitedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [rosterVersion, bumpRoster] = useForceUpdate();

  const trimmedQuery = query.trim();
  const viewKey = `${filter}|${trimmedQuery}`;
  const [attempts, setAttempts] = useState<Attempts>({ viewKey, byUser: {} });

  const { suggestions, isFetching } = useInviteUserSearch(room, trimmedQuery);

  // Room-level moderator grant offer for MindRoom agents.
  const roomGrantOffer = evaluateRoomModeratorGrant(room, me, levels, creators);
  const roomGrantLevel = roomGrantOffer.kind === 'grant' ? roomGrantOffer.level : undefined;
  const canOfferRoomGrant = roomGrantLevel !== undefined;
  const showGrantCheckbox = canOfferRoomGrant && filter !== 'people';
  const membersLoaded = room.membersLoaded();

  const memberLoads = useLoadedRoomMembers(client, canOfferRoomGrant ? [room.roomId] : []);
  useEffect(() => {
    const onMembership = (event: MatrixEvent | undefined, member?: RoomMember) => {
      if ((event?.getRoomId() ?? member?.roomId) === room.roomId) bumpRoster();
    };
    client.on(RoomMemberEvent.Membership, onMembership);
    return () => {
      client.removeListener(RoomMemberEvent.Membership, onMembership);
    };
  }, [client, room.roomId, bumpRoster]);

  const hasAgentModerator = useMemo(() => {
    void memberLoads;
    void rosterVersion;
    return (
      roomGrantLevel !== undefined &&
      membersLoaded &&
      hasModeratorMindroomAgent(room.getMembers(), me, levels, creators, roomGrantLevel)
    );
  }, [roomGrantLevel, membersLoaded, memberLoads, rosterVersion, room, me, levels, creators]);

  const defaultModerator = membersLoaded && !hasAgentModerator;
  const grantModerator = grantOverride ?? defaultModerator;
  const roleName = roomGrantLevel !== undefined ? grantRoleName(tags, roomGrantLevel, t) : '';

  // Live header counts: reflect session invites immediately without double-counting once sync lands.
  void rosterVersion;
  const joinedCount = room.getJoinedMemberCount();
  const roomInvitedCount = room.getInvitedMemberCount();
  let uncountedSessionInvites = 0;
  sessionInvitedIds.forEach((userId) => {
    const membership = room.getMember(userId)?.membership;
    if (membership !== KnownMembership.Invite && membership !== KnownMembership.Join) {
      uncountedSessionInvites += 1;
    }
  });
  const displayInvitedCount = roomInvitedCount + uncountedSessionInvites;

  const roomName = room.name?.trim();
  const title = roomName
    ? t('sharedUi.inviteUserPrompt.inviteToRoom', { room: roomName })
    : t('sharedUi.inviteUserPrompt.invite');
  const membersLabel = t('featureUi.room.membersDrawer.memberCount', { count: joinedCount });
  const subtitle =
    displayInvitedCount > 0
      ? t('sharedUi.inviteUserPrompt.memberSummary', {
          members: membersLabel,
          invited: t('featureUi.room.membersDrawer.invitedCount', { count: displayInvitedCount }),
        })
      : membersLabel;

  // Drop failed attempts if the person joined or got invited externally.
  const isAttemptOffered = (attempt: Attempt) =>
    attempt.state.status !== 'failed' ||
    filterInviteUserCandidates([attempt.user], room, me).length > 0;

  if (attempts.viewKey !== viewKey) {
    setAttempts({ viewKey, byUser: carryOver(attempts.byUser, isAttemptOffered) });
  } else if (!Object.values(attempts.byUser).every(isAttemptOffered)) {
    setAttempts({
      viewKey,
      byUser: Object.fromEntries(
        Object.entries(attempts.byUser).filter(([, attempt]) => isAttemptOffered(attempt))
      ),
    });
  }
  const placed = attempts.viewKey === viewKey ? attempts.byUser : {};

  // Build browse & search candidate lists.
  const directUserSet = useMemo(() => new Set(directUsers), [directUsers]);
  const directUserCandidates = useMemo<ServerUserDirectoryUser[]>(
    () => directUsers.map((userId) => ({ userId })),
    [directUsers]
  );
  const allLocalUsers = useMemo(
    () => mergeUserDirectoryUsers(directUserCandidates, cache.users),
    [directUserCandidates, cache.users]
  );
  const knownUsersMap = useMemo(() => {
    const map = new Map<string, ServerUserDirectoryUser>();
    allLocalUsers.forEach((user) => map.set(user.userId, user));
    suggestions.forEach((user) => map.set(user.userId, user));
    return map;
  }, [allLocalUsers, suggestions]);

  const eligibleLocalUsers = useMemo(() => {
    void rosterVersion;
    return filterInviteUserCandidates(allLocalUsers, room, me);
  }, [allLocalUsers, room, me, rosterVersion]);

  const isSearching = trimmedQuery.length > 0;
  const showSections = !isSearching && filter === 'all';

  let pinnedRows: InviteRow[] = [];
  let directRows: InviteRow[] = [];
  let directoryRows: InviteRow[] = [];
  let flatRows: InviteRow[] = [];

  if (showSections) {
    const directCandidates: Candidate[] = eligibleLocalUsers
      .filter((user) => directUserSet.has(user.userId))
      .sort(compareBrowseUsers)
      .slice(0, BROWSE_DIRECTORY_LIMIT)
      .map((user) => ({ user, listed: true, section: 'direct' }));
    const directoryBudget = Math.max(0, BROWSE_DIRECTORY_LIMIT - directCandidates.length);
    const directoryCandidates: Candidate[] = eligibleLocalUsers
      .filter((user) => !directUserSet.has(user.userId))
      .sort(compareBrowseUsers)
      .slice(0, directoryBudget)
      .map((user) => ({ user, listed: true, section: 'directory' }));

    const allAttempts = Object.values(placed);
    pinnedRows = mergeAttemptsIntoRows(
      [],
      allAttempts.filter((attempt) => attempt.section === 'search'),
      knownUsersMap
    );
    directRows = mergeAttemptsIntoRows(
      directCandidates,
      allAttempts.filter((attempt) => attempt.section === 'direct'),
      knownUsersMap
    );
    directoryRows = mergeAttemptsIntoRows(
      directoryCandidates,
      allAttempts.filter((attempt) => attempt.section === 'directory'),
      knownUsersMap
    );
  } else if (!isSearching) {
    const filteredBrowse: Candidate[] = eligibleLocalUsers
      .filter((user) => matchesFilter(user.userId, filter, me))
      .sort(compareBrowseUsers)
      .slice(0, BROWSE_DIRECTORY_LIMIT)
      .map((user) => ({ user, listed: true, section: 'directory' }));
    flatRows = mergeAttemptsIntoRows(filteredBrowse, Object.values(placed), knownUsersMap);
  } else {
    const filteredSuggestions: Candidate[] = suggestions
      .filter((user) => matchesFilter(user.userId, filter, me))
      .map((user) => ({ user, listed: true, section: 'search' }));
    const typedEligible =
      isUserId(trimmedQuery) &&
      filterInviteUserCandidates([{ userId: trimmedQuery }], room, me).length > 0 &&
      !filteredSuggestions.some((candidate) => candidate.user.userId === trimmedQuery);
    const searchCandidates: Candidate[] = typedEligible
      ? [
          { user: { userId: trimmedQuery }, listed: false, section: 'search' },
          ...filteredSuggestions,
        ]
      : filteredSuggestions;
    flatRows = mergeAttemptsIntoRows(searchCandidates, Object.values(placed), knownUsersMap);
  }

  const totalVisibleRows = showSections
    ? pinnedRows.length + directRows.length + directoryRows.length
    : flatRows.length;
  const isDirectoryLoading = !isSearching && cache.status === 'loading' && totalVisibleRows === 0;

  const updateAttemptState = (userId: string, state: AttemptState) => {
    setAttempts((current) => {
      const attempt = current.byUser[userId];
      if (!attempt) return current;
      return {
        ...current,
        byUser: { ...current.byUser, [userId]: { ...attempt, state } },
      };
    });
  };

  const inviteUser = async (
    candidate: Candidate,
    index: number,
    options?: { clearQuery?: boolean }
  ) => {
    const targetId = candidate.user.userId;
    if (inFlightRef.current.has(targetId)) return;
    const existing = placed[targetId]?.state;
    if (
      existing?.status === 'inviting' ||
      existing?.status === 'invited' ||
      existing?.status === 'grantFailed'
    ) {
      return;
    }

    const reason = note.trim() || undefined;
    const targetOffer = grantModerator
      ? evaluateModeratorGrant(room, targetId, me, levels, creators)
      : undefined;
    const grantCeiling = targetOffer?.kind === 'grant' ? targetOffer.level : undefined;

    inFlightRef.current.add(targetId);

    if (options?.clearQuery) {
      const nextViewKey = `${filter}|`;
      setQuery('');
      setAttempts((current) => ({
        viewKey: nextViewKey,
        byUser: {
          ...carryOver(current.byUser, isAttemptOffered),
          [targetId]: {
            ...candidate,
            section: 'search',
            index: 0,
            state: { status: 'inviting' },
          },
        },
      }));
      inputRef.current?.focus();
    } else {
      setAttempts((current) => {
        const previous = current.byUser[targetId];
        return {
          ...current,
          byUser: {
            ...current.byUser,
            [targetId]: {
              ...candidate,
              index: previous?.index ?? index,
              state: { status: 'inviting' },
            },
          },
        };
      });
    }

    try {
      try {
        await client.invite(room.roomId, targetId, reason);
      } catch (inviteError) {
        if (alive()) {
          updateAttemptState(targetId, { status: 'failed', error: inviteError });
        }
        return;
      }

      if (alive()) {
        setSessionInvitedIds((current) => {
          if (current.has(targetId)) return current;
          const next = new Set(current);
          next.add(targetId);
          return next;
        });
      }

      // Finish the submitted grant even if the user closed the dialog while invite was in flight.
      if (grantCeiling !== undefined) {
        const failure = await grantRoomModeratorRights(client, room, targetId, grantCeiling);
        if (failure) {
          const message = formatGrantFailure(failure, targetId, grantCeiling, tags, t);
          if (alive()) {
            setAnnouncement('');
            updateAttemptState(targetId, { status: 'grantFailed', message });
          } else if (client.clientRunning !== false) {
            store.set(detachedGrantErrorAtom, { message });
          }
          return;
        }
      }

      if (alive()) {
        updateAttemptState(targetId, { status: 'invited' });
        setAnnouncement(t('sharedUi.inviteUserPrompt.invited', { user: targetId }));
      }
    } finally {
      inFlightRef.current.delete(targetId);
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    moveFocus(listRef.current, inputRef.current, event.key === 'ArrowDown' ? 1 : -1);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && isUserId(trimmedQuery)) {
      const eligible = filterInviteUserCandidates([{ userId: trimmedQuery }], room, me).length > 0;
      const existing = placed[trimmedQuery]?.state;
      const busyOrDone =
        inFlightRef.current.has(trimmedQuery) ||
        existing?.status === 'inviting' ||
        existing?.status === 'invited' ||
        existing?.status === 'grantFailed';
      if (eligible && !busyOrDone) {
        event.preventDefault();
        const known = knownUsersMap.get(trimmedQuery);
        const candidate: Candidate = known
          ? { user: known, listed: true, section: 'search' }
          : { user: { userId: trimmedQuery }, listed: false, section: 'search' };
        void inviteUser(candidate, 0, { clearQuery: true });
      }
      return;
    }
    handleListKeyDown(event);
  };

  const handleClearSearch = () => {
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter className={phone ? modalCss.PhoneOverlayCenter : modalCss.SafeOverlayCenter}>
        <FocusTrap focusTrapOptions={dialogTrapOptions(inputRef, requestClose)}>
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
            variant="Surface"
            className={classNames(css.Dialog, phone && modalCss.PhoneModal)}
          >
            <Header size="500" className={css.TitleBar}>
              <div className={css.TitleBlock}>
                <Text as="h2" size="H4" id={TITLE_ID} truncate {...ownDirectionLine}>
                  {title}
                </Text>
                <Text as="p" size="T200" priority="300" truncate>
                  {subtitle}
                </Text>
              </div>
              <Button
                type="button"
                variant="Primary"
                fill="None"
                size="300"
                radii="300"
                onClick={requestClose}
              >
                <Text size="B300">{t('sharedUi.inviteUserPrompt.done')}</Text>
              </Button>
            </Header>

            <div className={css.Controls}>
              <Input
                ref={inputRef}
                type="search"
                size="400"
                variant="Background"
                radii="400"
                value={query}
                onChange={(evt: ChangeEvent<HTMLInputElement>) => setQuery(evt.target.value)}
                onKeyDown={handleInputKeyDown}
                before={<Icon size="200" src={Icons.Search} />}
                after={
                  query ? (
                    <IconButton
                      type="button"
                      size="300"
                      radii="300"
                      aria-label={t('mindroomUi.message-search.searchInput.clear')}
                      onClick={handleClearSearch}
                    >
                      <Icon size="100" src={Icons.Cross} />
                    </IconButton>
                  ) : undefined
                }
                placeholder={t('sharedUi.inviteUserPrompt.searchPlaceholder')}
                aria-label={t('sharedUi.inviteUserPrompt.searchPlaceholder')}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
              <div
                role="group"
                aria-label={t('sharedUi.inviteUserPrompt.filterLabel')}
                className={css.FilterRow}
              >
                {FILTERS.map((entry) => (
                  <Chip
                    key={entry}
                    type="button"
                    variant={entry === filter ? 'Primary' : 'SurfaceVariant'}
                    radii="Pill"
                    aria-pressed={entry === filter}
                    onClick={() => setFilter(entry)}
                  >
                    <Text size="T200">{t(FILTER_LABEL_KEY[entry])}</Text>
                  </Chip>
                ))}
              </div>
            </div>

            {/* Arrow keys move focus between row actions and back up into the search field. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <div ref={listRef} className={css.ListArea} onKeyDown={handleListKeyDown}>
              {showSections ? (
                <>
                  {pinnedRows.length > 0 && (
                    <ul className={css.List}>
                      {pinnedRows.map((row, index) => (
                        <InviteDirectoryRow
                          key={row.user.userId}
                          row={row}
                          viewerId={me}
                          onInvite={() => void inviteUser(row, index)}
                        />
                      ))}
                    </ul>
                  )}
                  {directRows.length > 0 && (
                    <>
                      <Text
                        as="h3"
                        id={directHeadingId}
                        size="L400"
                        priority="300"
                        className={css.SectionHeader}
                      >
                        {t('sharedUi.inviteUserPrompt.recentAndDirect')}
                      </Text>
                      <ul className={css.List} aria-labelledby={directHeadingId}>
                        {directRows.map((row, index) => (
                          <InviteDirectoryRow
                            key={row.user.userId}
                            row={row}
                            viewerId={me}
                            onInvite={() => void inviteUser(row, index)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {directoryRows.length > 0 && (
                    <>
                      <Text
                        as="h3"
                        id={directoryHeadingId}
                        size="L400"
                        priority="300"
                        className={css.SectionHeader}
                      >
                        {t('sharedUi.inviteUserPrompt.directory')}
                      </Text>
                      <ul className={css.List} aria-labelledby={directoryHeadingId}>
                        {directoryRows.map((row, index) => (
                          <InviteDirectoryRow
                            key={row.user.userId}
                            row={row}
                            viewerId={me}
                            onInvite={() => void inviteUser(row, index)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                flatRows.length > 0 && (
                  <ul className={css.List}>
                    {flatRows.map((row, index) => (
                      <InviteDirectoryRow
                        key={row.user.userId}
                        row={row}
                        viewerId={me}
                        onInvite={() => void inviteUser(row, index)}
                      />
                    ))}
                  </ul>
                )
              )}

              {(isDirectoryLoading || (isSearching && isFetching)) && (
                <div className={css.FetchingRow}>
                  <Spinner variant="Secondary" size="100" />
                  {totalVisibleRows === 0 && (
                    <Text as="span" size="T200" priority="300">
                      {t('sharedUi.inviteUserAutocomplete.searching')}
                    </Text>
                  )}
                </div>
              )}

              {!isDirectoryLoading && !(isSearching && isFetching) && totalVisibleRows === 0 && (
                <Text as="p" size="T200" priority="300" className={css.EmptyState}>
                  {isSearching
                    ? t('sharedUi.inviteUserPrompt.noMatches')
                    : t('sharedUi.inviteUserPrompt.emptyDirectory')}
                </Text>
              )}
            </div>

            <div className={css.Footer}>
              <button
                type="button"
                className={css.NoteToggle}
                aria-expanded={noteOpen}
                aria-controls={noteOpen ? noteInputId : undefined}
                onClick={() => setNoteOpen((open) => !open)}
              >
                <Text as="span" size="T200">
                  {noteOpen
                    ? t('sharedUi.inviteUserPrompt.hideNote')
                    : t('sharedUi.inviteUserPrompt.addNote')}
                </Text>
              </button>
              {noteOpen && (
                <Input
                  id={noteInputId}
                  size="400"
                  variant="Background"
                  radii="300"
                  value={note}
                  onChange={(evt: ChangeEvent<HTMLInputElement>) => setNote(evt.target.value)}
                  placeholder={t('sharedUi.inviteUserPrompt.notePlaceholder')}
                  aria-label={t('sharedUi.inviteUserPrompt.notePlaceholder')}
                  autoComplete="off"
                />
              )}
              {showGrantCheckbox && (
                <div className={css.ModeratorRow}>
                  <label className={css.ModeratorLabel}>
                    <Checkbox
                      variant="Primary"
                      size="200"
                      checked={grantModerator}
                      aria-describedby={moderatorHelpId}
                      // folds leaves onChange out of its Checkbox type; the click toggles the choice.
                      readOnly
                      onClick={() => setGrantOverride(!grantModerator)}
                    />
                    <Text as="span" size="T300">
                      {t('sharedUi.inviteUserPrompt.giveRoleRightsAgents', { role: roleName })}
                    </Text>
                  </label>
                  <Text id={moderatorHelpId} size="T200" priority="300">
                    {t('sharedUi.inviteUserPrompt.giveRoleRightsHelp', { role: roleName })}
                  </Text>
                </div>
              )}
            </div>

            <p role="status" className={css.VisuallyHidden}>
              {announcement}
            </p>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
