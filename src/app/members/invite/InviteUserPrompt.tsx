import {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  useCallback,
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
  RoomEvent,
  RoomMemberEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import { Dialog, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { UserAvatar } from '../../avatars/UserAvatar';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { isolateInSentence, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { nameInitials } from '../../lib/common';
import { describeError } from '../../lib/describeError';
import { useAlive } from '../../lib/hooks/useAlive';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { stopPropagation } from '../../lib/keyboard';
import { isComposingKey } from '../../shortcuts/shortcuts';
import { useDirectUsers } from '../../matrix/hooks/useDirectUsers';
import { useLoadedRoomMembers } from '../../matrix/hooks/useLoadedRoomMembers';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getMxIdLocalPart, isUserId } from '../../matrix/matrix';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { usePowerLevelTags } from '../usePowerLevelTags';
import { useInviteUserSearch } from '../useInviteUserSearch';
import { useUserDirectoryCache } from '../useUserDirectoryCache';
import { mergeUserDirectoryUsers, type ServerUserDirectoryUser } from '../userDirectoryCache';
import { filterInviteUserCandidates } from '../userDirectorySearch';
import { getDisplayName } from './InviteUserAutocomplete';
import {
  advanceModeratorGrantGeneration,
  createDetachedGrantError,
  detachedGrantErrorAtom,
  evaluateModeratorGrant,
  evaluateRoomModeratorGrant,
  formatGrantFailure,
  grantRoleName,
  grantRoomModeratorRights,
  hasModeratorMindroomAgent,
  type DetachedGrantError,
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
  | { status: 'failed'; error: unknown };

type Candidate = {
  user: ServerUserDirectoryUser;
  listed: boolean;
  section: RowSection;
};

type Attempt = Candidate & {
  index: number;
  reason?: string;
  state: AttemptState;
};

type InviteRow = Candidate & {
  reason?: string;
  state?: AttemptState;
};

/** The invites started from the sheet, placed for the query and filter they show under. */
type Attempts = {
  query: string;
  filter: InviteFilter;
  byUser: Record<string, Attempt>;
};

type Announcement = {
  id: number;
  text: string;
};

const TITLE_ID = 'invite-user-prompt-title';
/** First strong isolate and pop directional isolate: text between them keeps its own direction. */
const FSI = '\u2068';
const PDI = '\u2069';
const ROW_ACTION_ATTRIBUTE = 'data-invite-row-action';
const BROWSE_DIRECTORY_LIMIT = 100;
// Far more than can finish in one render; older lines have been read out by then.
const ANNOUNCEMENT_LIMIT = 20;
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

const browseCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

const matchesFilter = (userId: string, filter: InviteFilter, viewerId: string): boolean => {
  if (filter === 'all') return true;
  const isAgent = isMindroomAgentUserIdForViewer(userId, viewerId);
  return filter === 'agents' ? isAgent : !isAgent;
};

const compareBrowseUsers = (a: ServerUserDirectoryUser, b: ServerUserDirectoryUser): number =>
  browseCollator.compare(getDisplayName(a), getDisplayName(b)) || a.userId.localeCompare(b.userId);

const rowDisplayName = ({ user, listed }: Pick<Candidate, 'user' | 'listed'>): string =>
  listed ? getDisplayName(user) : user.userId;

/**
 * Moves the attempts that `carried` keeps (invites on their way and failures to retry) to another
 * query or filter, pinned in their order. The others stay behind in their own view.
 */
const carryOver = (
  byUser: Readonly<Record<string, Attempt>>,
  carried: (attempt: Attempt) => boolean
): Record<string, Attempt> =>
  Object.fromEntries(
    Object.values(byUser)
      .filter(carried)
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
    .forEach((attempt, order) => {
      const listedUser = knownUsers?.get(attempt.user.userId);
      const row: InviteRow = listedUser ? { ...attempt, user: listedUser, listed: true } : attempt;
      // Never before an attempt that sorts earlier: rows pinned by Enter have negative indices,
      // and two attempts can share one.
      const position = Math.min(Math.max(attempt.index, order), rows.length);
      rows.splice(position, 0, row);
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

const withoutAttempt = (
  byUser: Readonly<Record<string, Attempt>>,
  userId: string
): Record<string, Attempt> =>
  Object.fromEntries(Object.entries(byUser).filter(([attemptId]) => attemptId !== userId));

function InviteDirectoryRow({
  row,
  viewerId,
  authenticatedMedia,
  onInvite,
}: {
  row: InviteRow;
  viewerId: string;
  authenticatedMedia: boolean;
  onInvite: () => void;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const subtitleId = useId();
  const { user, listed, state } = row;
  const name = rowDisplayName(row);
  const isAgent = isMindroomAgentUserIdForViewer(user.userId, viewerId);
  const avatarSrc = user.avatarMxcUrl
    ? mxcUrlToHttp(client, user.avatarMxcUrl, authenticatedMedia, 64, 64, 'crop') ?? undefined
    : undefined;
  const inviting = state?.status === 'inviting';
  const sent = state?.status === 'invited';
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
    before = undefined;
    buttonLabel = t('sharedUi.roomCard.retry');
    ariaLabel = t('sharedUi.inviteUserPrompt.retryUser', { user: name });
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
          <Text
            as="span"
            size="T300"
            truncate={listed}
            className={listed ? undefined : css.NameWrap}
            title={name}
            {...ownDirectionLine}
          >
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
          className={css.Subtitle}
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

function RowList({
  rows,
  viewerId,
  authenticatedMedia,
  ariaLabel,
  ariaLabelledBy,
  onInvite,
}: {
  rows: readonly InviteRow[];
  viewerId: string;
  authenticatedMedia: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  onInvite: (row: InviteRow, index: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className={css.List} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
      {rows.map((row, index) => (
        <InviteDirectoryRow
          key={row.user.userId}
          row={row}
          viewerId={viewerId}
          authenticatedMedia={authenticatedMedia}
          onInvite={() => onInvite(row, index)}
        />
      ))}
    </ul>
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
  const grantAlertsId = useId();
  const store = useStore();
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(new Set<string>());
  // The note as last typed, read when an invite starts: two invites started before the next
  // render must not both take it.
  const noteRef = useRef('');
  const pinOrderRef = useRef(0);
  const announcementIdRef = useRef(0);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InviteFilter>('all');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [grantOverride, setGrantOverride] = useState<boolean>();
  const [announcements, setAnnouncements] = useState<readonly Announcement[]>([]);
  const [enterHint, setEnterHint] = useState<string>();
  // Grants that failed while the sheet is open, shown above the list until dismissed. They belong
  // to the sheet and to no row: a row can leave (another filter, a decline) and be invited again
  // while its alert is still to be read.
  const [grantAlerts, setGrantAlerts] = useState<readonly DetachedGrantError[]>([]);
  const [rosterVersion, bumpRoster] = useForceUpdate();
  // With lazy-loaded members the room knows only the members whose events it has seen; without
  // the full list a joined member would be offered an invite.
  const memberLoads = useLoadedRoomMembers(client, [room.roomId]);

  const trimmedQuery = query.trim();
  // Invariant, the one of `MembersInviteSection`: the room's own state alone says who can be
  // invited (`isInvitable`), and `attempts` holds only what the sheet did in the current view, an
  // invite on its way (`inviting`), sent (`invited`) or failed (`failed`) per user. Another query
  // or filter carries over the first and the last and leaves a sent invite behind. In the moment
  // before /sync has a sent invite, another view can offer its user again: the homeserver answers
  // that invite, and nothing here guesses the order of /sync and the invite's response.
  const [attempts, setAttempts] = useState<Attempts>({
    query: trimmedQuery,
    filter,
    byUser: {},
  });

  // Filter before ranking, limiting, and server-fallback threshold so 8 people never crowd out
  // agents. A new predicate on every roster change makes the search drop people who joined, were
  // invited or arrived with the member list before it limits, too.
  const searchPredicate = useMemo(() => {
    void rosterVersion;
    void memberLoads;
    return (user: ServerUserDirectoryUser) => matchesFilter(user.userId, filter, me);
  }, [filter, me, rosterVersion, memberLoads]);
  const { suggestions, isFetching } = useInviteUserSearch(room, trimmedQuery, searchPredicate);

  // Room-level moderator grant offer for MindRoom agents (always visible when offered so consent
  // is never hidden on tab switches).
  const roomGrantOffer = evaluateRoomModeratorGrant(room, me, levels, creators);
  const roomGrantLevel = roomGrantOffer.kind === 'grant' ? roomGrantOffer.level : undefined;
  const canOfferRoomGrant = roomGrantLevel !== undefined;
  const showGrantCheckbox = canOfferRoomGrant;
  const membersLoaded = room.membersLoaded();

  useEffect(() => {
    // A membership that changed and a new room summary change who the lists offer and what the
    // header counts: both re-read the room.
    const onMembership = (event: MatrixEvent | undefined, member?: RoomMember) => {
      if ((event?.getRoomId() ?? member?.roomId) !== room.roomId) return;
      bumpRoster();
      const userId = member?.userId;
      const membership = member?.membership;
      if (
        userId === undefined ||
        (membership !== KnownMembership.Leave && membership !== KnownMembership.Knock)
      ) {
        return;
      }
      // The invitee declined or was removed, and may knock since: the row offers the invite again.
      setAttempts((current) =>
        current.byUser[userId]?.state.status === 'invited'
          ? { ...current, byUser: withoutAttempt(current.byUser, userId) }
          : current
      );
    };
    client.on(RoomMemberEvent.Membership, onMembership);
    room.on(RoomEvent.Summary, bumpRoster);
    return () => {
      client.removeListener(RoomMemberEvent.Membership, onMembership);
      room.removeListener(RoomEvent.Summary, bumpRoster);
    };
  }, [client, room, bumpRoster]);

  // When the keyboard comes up, the body scrolls what no longer fits, with the focused field (the
  // note, at its foot) out of sight below. The browser scrolled to it on focus, before the
  // viewport shrank, and does not again. A field that is in sight stays where it is.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (focused?.tagName !== 'INPUT' || !body.contains(focused)) return;
      focused.scrollIntoView({ block: 'nearest' });
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

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

  const isInvitable = useCallback(
    (userId: string): boolean => {
      void rosterVersion;
      void memberLoads;
      return filterInviteUserCandidates([{ userId }], room, me).length > 0;
    },
    [room, me, rosterVersion, memberLoads]
  );

  // The room's own counts, as the members panel shows them; the listeners above refresh them.
  const joinedCount = room.getJoinedMemberCount();
  const invitedCount = room.getInvitedMemberCount();

  const roomName = useRoomName(room).trim();
  // Isolate roomName so an RTL room name never flips an LTR "Invite to ..." heading. Direction
  // controls in the name show as their code points first, as a room's name does elsewhere, so
  // none can end the isolate early or reorder the heading. A right-to-left catalog isolates every
  // placeholder itself (localeAdditions.test.ts), and one pair of isolates is enough.
  const isolatedRoomName = isolateInSentence(revealDirectionControls(roomName));
  const title = roomName
    ? t('sharedUi.inviteUserPrompt.inviteToRoom', { room: isolatedRoomName }).replace(
        `${FSI}${isolatedRoomName}${PDI}`,
        // A function, so a "$" in the name stays as written.
        () => isolatedRoomName
      )
    : t('sharedUi.inviteUserPrompt.invite');
  const membersLabel = t('featureUi.room.membersDrawer.memberCount', { count: joinedCount });
  const subtitle =
    invitedCount > 0
      ? t('sharedUi.inviteUserPrompt.memberSummary', {
          members: membersLabel,
          invited: t('featureUi.room.membersDrawer.invitedCount', { count: invitedCount }),
        })
      : membersLabel;

  // Drop failed attempts if the person joined or got invited externally.
  const isAttemptOffered = (attempt: Attempt) =>
    attempt.state.status !== 'failed' || isInvitable(attempt.user.userId);
  // Into another query or filter go invites on their way and failures to retry. Sent invites stay
  // behind in their view.
  const isAttemptCarried = (attempt: Attempt) =>
    isAttemptOffered(attempt) && attempt.state.status !== 'invited';

  const inView = attempts.query === trimmedQuery && attempts.filter === filter;
  if (!inView) {
    setAttempts({
      query: trimmedQuery,
      filter,
      byUser: carryOver(attempts.byUser, isAttemptCarried),
    });
  } else if (!Object.values(attempts.byUser).every(isAttemptOffered)) {
    setAttempts({
      ...attempts,
      byUser: Object.fromEntries(
        Object.entries(attempts.byUser).filter(([, attempt]) => isAttemptOffered(attempt))
      ),
    });
  }
  const placed = inView ? attempts.byUser : {};

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
    void memberLoads;
    return filterInviteUserCandidates(allLocalUsers, room, me);
  }, [allLocalUsers, room, me, rosterVersion, memberLoads]);

  // Memoize sorting separately from note/attempt edits so typing never re-sorts a large directory.
  const sortedBrowse = useMemo(() => {
    if (filter === 'all') {
      const direct = eligibleLocalUsers
        .filter((user) => directUserSet.has(user.userId))
        .sort(compareBrowseUsers);
      const directory = eligibleLocalUsers
        .filter((user) => !directUserSet.has(user.userId))
        .sort(compareBrowseUsers);
      return { direct, directory, flat: [] as ServerUserDirectoryUser[] };
    }
    const flat = eligibleLocalUsers
      .filter((user) => matchesFilter(user.userId, filter, me))
      .sort(compareBrowseUsers);
    return {
      direct: [] as ServerUserDirectoryUser[],
      directory: [] as ServerUserDirectoryUser[],
      flat,
    };
  }, [eligibleLocalUsers, directUserSet, filter, me]);

  const isSearching = trimmedQuery.length > 0;
  const showSections = !isSearching && filter === 'all';
  const allAttempts = Object.values(placed);
  const attemptedIds = new Set(Object.keys(placed));

  let pinnedRows: InviteRow[] = [];
  let directRows: InviteRow[] = [];
  let directoryRows: InviteRow[] = [];
  let flatRows: InviteRow[] = [];
  let searchMatchCount = 0;

  if (showSections) {
    // Deduplicate all attempted MXIDs across every section before spending the 100-row budget.
    const remainingAfterAttempts = Math.max(0, BROWSE_DIRECTORY_LIMIT - allAttempts.length);
    const directCandidates: Candidate[] = sortedBrowse.direct
      .filter((user) => !attemptedIds.has(user.userId))
      .slice(0, remainingAfterAttempts)
      .map((user) => ({ user, listed: true, section: 'direct' }));
    const directoryBudget = Math.max(0, remainingAfterAttempts - directCandidates.length);
    const directoryCandidates: Candidate[] = sortedBrowse.directory
      .filter((user) => !attemptedIds.has(user.userId))
      .slice(0, directoryBudget)
      .map((user) => ({ user, listed: true, section: 'directory' }));

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
    const remainingBudget = Math.max(0, BROWSE_DIRECTORY_LIMIT - allAttempts.length);
    const filteredBrowse: Candidate[] = sortedBrowse.flat
      .filter((user) => !attemptedIds.has(user.userId))
      .slice(0, remainingBudget)
      .map((user) => ({ user, listed: true, section: 'directory' }));
    flatRows = mergeAttemptsIntoRows(filteredBrowse, allAttempts, knownUsersMap);
  } else {
    const filteredSuggestions: Candidate[] = suggestions.map((user) => ({
      user,
      listed: true,
      section: 'search',
    }));
    const typedEligible =
      isUserId(trimmedQuery) &&
      isInvitable(trimmedQuery) &&
      !filteredSuggestions.some((candidate) => candidate.user.userId === trimmedQuery);
    const knownTyped = typedEligible ? knownUsersMap.get(trimmedQuery) : undefined;
    const typedCandidate: Candidate | undefined = typedEligible
      ? knownTyped
        ? { user: knownTyped, listed: true, section: 'search' }
        : { user: { userId: trimmedQuery }, listed: false, section: 'search' }
      : undefined;
    const searchCandidates: Candidate[] = typedCandidate
      ? [typedCandidate, ...filteredSuggestions]
      : filteredSuggestions;
    searchMatchCount = searchCandidates.length;
    flatRows = mergeAttemptsIntoRows(searchCandidates, allAttempts, knownUsersMap);
  }

  // Inline hint when a typed valid MXID is already in the room, invited, or banned.
  let nonInvitableHint: string | undefined;
  if (
    isSearching &&
    isUserId(trimmedQuery) &&
    placed[trimmedQuery] === undefined &&
    !isInvitable(trimmedQuery)
  ) {
    const membership = room.getMember(trimmedQuery)?.membership;
    if (trimmedQuery === me || membership === KnownMembership.Join) {
      nonInvitableHint = t('sharedUi.inviteUserPrompt.alreadyInRoom');
    } else if (membership === KnownMembership.Invite) {
      nonInvitableHint = t('sharedUi.inviteUserPrompt.alreadyInvited');
    } else if (membership === KnownMembership.Ban) {
      nonInvitableHint = t('sharedUi.inviteUserPrompt.bannedFromRoom');
    }
  }
  const activeHint = nonInvitableHint ?? enterHint;
  const hasSearchMatches = searchMatchCount > 0;

  const totalVisibleRows = showSections
    ? pinnedRows.length + directRows.length + directoryRows.length
    : flatRows.length;
  const isDirectoryLoading = !isSearching && cache.status === 'loading' && totalVisibleRows === 0;
  // The directory never loaded, and nothing retries it by itself.
  const directoryFailed = !isSearching && cache.status === 'error' && cache.users.length === 0;

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

  const updateNote = (value: string) => {
    noteRef.current = value;
    setNote(value);
  };

  // Every finished invite gets a line of its own in the live region, so two that finish together
  // are both read out and nothing else clears them.
  const announce = (text: string) => {
    announcementIdRef.current += 1;
    const entry: Announcement = { id: announcementIdRef.current, text };
    setAnnouncements((current) => [...current, entry].slice(-ANNOUNCEMENT_LIMIT));
  };

  const inviteUser = async (
    candidate: Candidate,
    index: number,
    options?: { clearQuery?: boolean }
  ) => {
    const targetId = candidate.user.userId;
    if (inFlightRef.current.has(targetId)) return;
    const existingAttempt = placed[targetId];
    const existingState = existingAttempt?.state;
    if (existingState?.status === 'inviting' || existingState?.status === 'invited') return;

    // A new invite takes the note with it at once, so the next person invited never gets it, also
    // when this invite is still pending or fails. A retry sends the note its attempt took and
    // leaves the draft alone.
    let reason: string | undefined;
    if (existingState?.status === 'failed') {
      reason = existingAttempt?.reason;
    } else if (noteOpen) {
      reason = noteRef.current.trim() || undefined;
      if (reason !== undefined) updateNote('');
    }

    const targetOffer = grantModerator
      ? evaluateModeratorGrant(room, targetId, me, levels, creators)
      : undefined;
    const grantCeiling = targetOffer?.kind === 'grant' ? targetOffer.level : undefined;

    inFlightRef.current.add(targetId);
    // Whatever grant an earlier invite of this user still has in the queue is superseded: this
    // invite's choice counts, also when it is to give no rights.
    const generation = advanceModeratorGrantGeneration(client, room.roomId, targetId);
    setEnterHint(undefined);

    if (options?.clearQuery) {
      // Below every index a carried-over row has, and below the last pinned one: the newest
      // pinned row leads, and no two share a place.
      pinOrderRef.current -= 1;
      const pinnedIndex = pinOrderRef.current;
      setQuery('');
      setAttempts((current) => ({
        query: '',
        filter,
        byUser: {
          ...carryOver(current.byUser, isAttemptCarried),
          [targetId]: {
            ...candidate,
            section: 'search',
            index: pinnedIndex,
            reason,
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
              reason,
              state: { status: 'inviting' },
            },
          },
        };
      });
    }

    try {
      await client.invite(room.roomId, targetId, reason);
    } catch (inviteError) {
      if (alive()) {
        updateAttemptState(targetId, { status: 'failed', error: inviteError });
      }
      return;
    } finally {
      inFlightRef.current.delete(targetId);
    }

    if (alive()) {
      // The invite is sent, whatever becomes of the grant: the row and the live region say so now.
      updateAttemptState(targetId, { status: 'invited' });
      announce(t('sharedUi.inviteUserPrompt.invited', { user: targetId }));
    }

    // Finish the submitted grant even if the user closed the dialog while invite was in flight.
    if (grantCeiling === undefined) return;
    const grantFailure = await grantRoomModeratorRights(
      client,
      room,
      targetId,
      grantCeiling,
      generation
    );
    if (!grantFailure) return;
    const failure = createDetachedGrantError(
      formatGrantFailure(grantFailure, targetId, grantCeiling, tags, t)
    );
    if (alive()) {
      setGrantAlerts((current) => [...current, failure]);
    } else if (client.clientRunning !== false) {
      store.set(detachedGrantErrorAtom, (current) => [...current, failure]);
    }
  };

  const handleRowInvite = (row: InviteRow, index: number) => {
    void inviteUser(row, index);
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    moveFocus(listRef.current, inputRef.current, event.key === 'ArrowDown' ? 1 : -1);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const native = event.nativeEvent as Partial<globalThis.KeyboardEvent> | undefined;
    if (
      isComposingKey({
        key: native?.key ?? event.key,
        isComposing: Boolean(native?.isComposing),
        keyCode: native?.keyCode ?? event.keyCode ?? 0,
      })
    ) {
      return;
    }

    if (event.key === 'Enter') {
      if (isUserId(trimmedQuery)) {
        const existing = placed[trimmedQuery]?.state;
        const busyOrDone =
          inFlightRef.current.has(trimmedQuery) ||
          existing?.status === 'inviting' ||
          existing?.status === 'invited';
        if (isInvitable(trimmedQuery) && !busyOrDone) {
          event.preventDefault();
          const known = knownUsersMap.get(trimmedQuery);
          const candidate: Candidate = known
            ? { user: known, listed: true, section: 'search' }
            : { user: { userId: trimmedQuery }, listed: false, section: 'search' };
          void inviteUser(candidate, 0, { clearQuery: true });
        }
      } else if (
        trimmedQuery.startsWith('@') ||
        (trimmedQuery.length > 0 && !hasSearchMatches && !isFetching)
      ) {
        // Plain text that lists matches, or whose search still runs, is a search, not a
        // mistyped ID.
        event.preventDefault();
        setEnterHint(t('featureUi.createChat.pleaseEnterAValidUserId'));
      }
      return;
    }
    handleListKeyDown(event);
  };

  const handleQueryChange = (evt: ChangeEvent<HTMLInputElement>) => {
    setEnterHint(undefined);
    setQuery(evt.target.value);
  };

  const handleFilterChange = (next: InviteFilter) => {
    setEnterHint(undefined);
    setFilter(next);
  };

  const handleClearSearch = () => {
    setEnterHint(undefined);
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter
        className={classNames(
          phone ? modalCss.PhoneOverlayCenter : modalCss.SafeOverlayCenter,
          css.ViewportCenter
        )}
      >
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
                <Text as="h2" size="H4" id={TITLE_ID} truncate>
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

            <div ref={bodyRef} className={css.Body}>
              <div className={css.Controls}>
                <Input
                  ref={inputRef}
                  className={css.SearchField}
                  type="search"
                  size="400"
                  variant="Background"
                  radii="400"
                  value={query}
                  onChange={handleQueryChange}
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
                      className={css.FilterChip}
                      variant={entry === filter ? 'Primary' : 'SurfaceVariant'}
                      radii="Pill"
                      aria-pressed={entry === filter}
                      onClick={() => handleFilterChange(entry)}
                    >
                      <Text size="T200">{t(FILTER_LABEL_KEY[entry])}</Text>
                    </Chip>
                  ))}
                </div>
                {/* Above the rows, also where a short viewport scrolls them all as one: nobody
                    reaches an Invite button without passing the choice it acts on. */}
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

              {grantAlerts.length > 0 && (
                <div
                  id={grantAlertsId}
                  className={css.GrantAlerts}
                  role="region"
                  aria-labelledby={grantAlertsId}
                  // A stop for Tab, so the keyboard can scroll long warnings where the browser does
                  // not make a scrolling box focusable itself (Safari). Its text is its name.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                  tabIndex={0}
                >
                  {grantAlerts.map((alert) => (
                    <div key={alert.id} className={css.GrantAlert}>
                      <Text as="span" size="T200" role="alert" className={css.GrantAlertText}>
                        {alert.message}
                      </Text>
                      <IconButton
                        type="button"
                        size="300"
                        radii="300"
                        aria-label={t('mindroomUi.notices.dismiss')}
                        onClick={() =>
                          setGrantAlerts((current) =>
                            current.filter((item) => item.id !== alert.id)
                          )
                        }
                      >
                        <Icon size="100" src={Icons.Cross} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              )}

              {/* Arrow keys move focus between row actions and back up into the search field. */}
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div ref={listRef} className={css.ListArea} onKeyDown={handleListKeyDown}>
                {/* Always there, so a screen reader hears a hint that appears in it. */}
                <div role="status">
                  {activeHint && (
                    <Text as="p" size="T200" priority="300" className={css.InlineHint}>
                      {activeHint}
                    </Text>
                  )}
                </div>

                {showSections ? (
                  <>
                    <RowList
                      rows={pinnedRows}
                      viewerId={me}
                      authenticatedMedia={authenticatedMedia}
                      ariaLabel={t('sharedUi.inviteUserPrompt.invite')}
                      onInvite={handleRowInvite}
                    />
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
                        <RowList
                          rows={directRows}
                          viewerId={me}
                          authenticatedMedia={authenticatedMedia}
                          ariaLabelledBy={directHeadingId}
                          onInvite={handleRowInvite}
                        />
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
                        <RowList
                          rows={directoryRows}
                          viewerId={me}
                          authenticatedMedia={authenticatedMedia}
                          ariaLabelledBy={directoryHeadingId}
                          onInvite={handleRowInvite}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <RowList
                    rows={flatRows}
                    viewerId={me}
                    authenticatedMedia={authenticatedMedia}
                    onInvite={handleRowInvite}
                  />
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

                {directoryFailed && (
                  <div className={css.DirectoryError}>
                    <Text as="p" size="T200" priority="300" role="alert">
                      {t('sharedUi.invites.actionFailed')}
                    </Text>
                    <Button
                      type="button"
                      size="300"
                      variant="Secondary"
                      fill="Soft"
                      radii="300"
                      onClick={() => {
                        void cache.refresh();
                      }}
                    >
                      <Text as="span" size="B300">
                        {t('sharedUi.roomCard.retry')}
                      </Text>
                    </Button>
                  </div>
                )}

                {!isDirectoryLoading &&
                  !directoryFailed &&
                  !(isSearching && isFetching) &&
                  totalVisibleRows === 0 &&
                  !activeHint && (
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
                    onChange={(evt: ChangeEvent<HTMLInputElement>) => updateNote(evt.target.value)}
                    placeholder={t('sharedUi.inviteUserPrompt.notePlaceholder')}
                    aria-label={t('sharedUi.inviteUserPrompt.notePlaceholder')}
                    autoComplete="off"
                  />
                )}
              </div>
            </div>

            {/* Not atomic: each line is read as it is added, the earlier ones are not repeated. */}
            <div role="status" aria-atomic="false" className={css.VisuallyHidden}>
              {announcements.map((entry) => (
                <p key={entry.id}>{entry.text}</p>
              ))}
            </div>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
