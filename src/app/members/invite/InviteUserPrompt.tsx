import { ChangeEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import {
  Avatar,
  Badge,
  Box,
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

type InviteFilter = 'all' | 'people' | 'agents';
type RowSection = 'direct' | 'directory' | 'search';
type AttemptState =
  | { status: 'inviting' }
  | { status: 'invited' }
  | { status: 'failed'; error: unknown };
type Candidate = { user: ServerUserDirectoryUser; listed: boolean; section: RowSection };
type Attempt = Candidate & { index: number; reason?: string; state: AttemptState };
type InviteRow = Candidate & { reason?: string; state?: AttemptState };
type RowGroup = {
  key: string;
  headingId?: string;
  heading?: string;
  ariaLabel?: string;
  rows: readonly InviteRow[];
};

const TITLE_ID = 'invite-user-prompt-title';
const ROW_ACTION_ATTR = 'data-invite-row-action';
const BROWSE_LIMIT = 100;
const FILTERS: readonly InviteFilter[] = ['all', 'people', 'agents'];
const FILTER_LABEL_KEY = {
  all: 'sharedUi.inviteUserPrompt.filterAll',
  people: 'sharedUi.inviteUserPrompt.filterPeople',
  agents: 'sharedUi.inviteUserPrompt.filterAgents',
} as const;

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

const matchesFilter = (userId: string, filter: InviteFilter, viewerId: string): boolean => {
  if (filter === 'all') return true;
  const isAgent = isMindroomAgentUserIdForViewer(userId, viewerId);
  return filter === 'agents' ? isAgent : !isAgent;
};

const compareBrowseUsers = (a: ServerUserDirectoryUser, b: ServerUserDirectoryUser): number =>
  collator.compare(getDisplayName(a), getDisplayName(b)) || a.userId.localeCompare(b.userId);

const carryOver = (
  byUser: Readonly<Record<string, Attempt>>,
  keep: (attempt: Attempt) => boolean
): Record<string, Attempt> =>
  Object.fromEntries(
    Object.values(byUser)
      .filter(keep)
      .sort((a, b) => a.index - b.index)
      .map((attempt, index) => [attempt.user.userId, { ...attempt, section: 'search', index }])
  );

/** Splices attempts back into their original positions so rows never jump when membership syncs. */
const mergeAttemptsIntoRows = (
  candidates: readonly Candidate[],
  attempts: readonly Attempt[],
  knownUsers: ReadonlyMap<string, ServerUserDirectoryUser>
): InviteRow[] => {
  const attemptIds = new Set(attempts.map((a) => a.user.userId));
  const rows: InviteRow[] = candidates.filter((c) => !attemptIds.has(c.user.userId));
  [...attempts]
    .sort((a, b) => a.index - b.index)
    .forEach((attempt, order) => {
      const listed = knownUsers.get(attempt.user.userId);
      const row: InviteRow = listed ? { ...attempt, user: listed, listed: true } : attempt;
      rows.splice(Math.min(Math.max(attempt.index, order), rows.length), 0, row);
    });
  return rows;
};

const moveFocus = (container: HTMLElement | null, field: HTMLElement | null, step: 1 | -1) => {
  const actions = [...(container?.querySelectorAll<HTMLElement>(`[${ROW_ACTION_ATTR}]`) ?? [])];
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const next = actions.findIndex((el) => el === active) + step;
  if (next < 0) field?.focus();
  else actions[Math.min(next, actions.length - 1)]?.focus();
};

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
  const name = listed ? getDisplayName(user) : user.userId;
  const isAgent = isMindroomAgentUserIdForViewer(user.userId, viewerId);
  const avatarSrc = user.avatarMxcUrl
    ? mxcUrlToHttp(client, user.avatarMxcUrl, authenticatedMedia, 64, 64, 'crop') ?? undefined
    : undefined;
  const status = state?.status;
  const disabled = status === 'inviting' || status === 'invited';
  const variant = status === 'invited' ? 'Success' : status === 'failed' ? 'Critical' : 'Primary';
  const before =
    status === 'inviting' ? (
      <Spinner size="50" variant="Primary" />
    ) : status === 'invited' ? (
      <Icon size="50" src={Icons.Check} />
    ) : status === 'failed' ? undefined : (
      <Icon size="50" src={Icons.Plus} />
    );
  const label =
    status === 'invited'
      ? t('featureUi.room.membersDrawer.inviteSent')
      : status === 'failed'
      ? t('sharedUi.roomCard.retry')
      : t('featureUi.room.membersDrawer.invite');
  const ariaLabel =
    status === 'invited'
      ? undefined
      : status === 'failed'
      ? t('sharedUi.inviteUserPrompt.retryUser', { user: name })
      : t('featureUi.room.membersDrawer.inviteUser', { user: name });

  return (
    <li className={css.Row}>
      <Avatar size="300" radii={isAgent ? '300' : 'Pill'} style={{ flexShrink: 0 }} aria-hidden>
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
      <Box direction="Column" grow="Yes" style={{ minInlineSize: 0 }}>
        <Box alignItems="Center" gap="100" style={{ minInlineSize: 0 }}>
          <Text
            as="span"
            size="T300"
            truncate={listed}
            className={listed ? undefined : css.WrapText}
            title={name}
            {...ownDirectionLine}
          >
            {name}
          </Text>
          {isAgent && (
            <Badge variant="Primary" fill="Soft" radii="300" style={{ flexShrink: 0 }}>
              <Text as="span" size="L400">
                {t('sharedUi.agentCard.agent')}
              </Text>
            </Badge>
          )}
        </Box>
        <Text
          as="span"
          id={subtitleId}
          size="T200"
          priority="300"
          className={css.WrapText}
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
      </Box>
      <Button
        type="button"
        size="300"
        variant={variant}
        fill={status === 'invited' ? 'None' : 'Soft'}
        radii="300"
        className={classNames(css.RowAction, status === 'invited' && css.RowActionSent)}
        {...{ [ROW_ACTION_ATTR]: '' }}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={subtitleId}
        onClick={disabled ? undefined : onInvite}
        before={before}
      >
        <Text as="span" size="B300">
          {label}
        </Text>
      </Button>
    </li>
  );
}

/** Instant Directory Sheet for inviting people and agents to a room. */
export function InviteUserPrompt({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const noteInputId = `${idPrefix}-note`;
  const moderatorHelpId = `${idPrefix}-mod`;
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(new Set<string>());
  const noteRef = useRef('');
  const pinOrderRef = useRef(0);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InviteFilter>('all');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [grantOverride, setGrantOverride] = useState<boolean>();
  const [announcement, setAnnouncement] = useState('');
  const [enterHint, setEnterHint] = useState<string>();
  const [grantError, setGrantError] = useState<string>();
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [rosterVersion, bumpRoster] = useForceUpdate();
  const memberLoads = useLoadedRoomMembers(client, [room.roomId]);

  const trimmedQuery = query.trim();
  const searchPredicate = useMemo(() => {
    void rosterVersion;
    void memberLoads;
    return (user: ServerUserDirectoryUser) => matchesFilter(user.userId, filter, me);
  }, [filter, me, rosterVersion, memberLoads]);
  const { suggestions, isFetching } = useInviteUserSearch(room, trimmedQuery, searchPredicate);

  useEffect(() => {
    const onMembership = (event: MatrixEvent | undefined, member?: RoomMember) => {
      if ((event?.getRoomId() ?? member?.roomId) !== room.roomId) return;
      bumpRoster();
      const userId = member?.userId;
      const m = member?.membership;
      if (!userId || (m !== KnownMembership.Leave && m !== KnownMembership.Knock)) return;
      setAttempts((cur) => {
        if (cur[userId]?.state.status !== 'invited') return cur;
        const next = { ...cur };
        delete next[userId];
        return next;
      });
    };
    client.on(RoomMemberEvent.Membership, onMembership);
    room.on(RoomEvent.Summary, bumpRoster);
    return () => {
      client.removeListener(RoomMemberEvent.Membership, onMembership);
      room.removeListener(RoomEvent.Summary, bumpRoster);
    };
  }, [client, room, bumpRoster]);

  // Keep a focused input (e.g. the invite note at the foot) visible when the mobile keyboard shrinks Body.
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

  const roomGrantOffer = evaluateRoomModeratorGrant(room, me, levels, creators);
  const roomGrantLevel = roomGrantOffer.kind === 'grant' ? roomGrantOffer.level : undefined;
  const membersLoaded = room.membersLoaded();
  const hasAgentModerator =
    roomGrantLevel !== undefined &&
    membersLoaded &&
    hasModeratorMindroomAgent(room.getMembers(), me, levels, creators, roomGrantLevel);
  const grantModerator = grantOverride ?? (membersLoaded && !hasAgentModerator);
  const roleName = roomGrantLevel !== undefined ? grantRoleName(tags, roomGrantLevel, t) : '';
  const isInvitable = (userId: string) =>
    filterInviteUserCandidates([{ userId }], room, me).length > 0;

  const roomName = useRoomName(room).trim();
  const title = roomName
    ? t('sharedUi.inviteUserPrompt.inviteToRoom', {
        room: isolateInSentence(revealDirectionControls(roomName)),
      })
    : t('sharedUi.inviteUserPrompt.invite');
  const membersLabel = t('featureUi.room.membersDrawer.memberCount', {
    count: room.getJoinedMemberCount(),
  });
  const invitedCount = room.getInvitedMemberCount();
  const subtitle =
    invitedCount > 0
      ? t('sharedUi.inviteUserPrompt.memberSummary', {
          members: membersLabel,
          invited: t('featureUi.room.membersDrawer.invitedCount', { count: invitedCount }),
        })
      : membersLabel;

  const activeAttempts = Object.values(attempts).filter(
    (a) => a.state.status !== 'failed' || isInvitable(a.user.userId)
  );
  const placed: Record<string, Attempt> = Object.fromEntries(
    activeAttempts.map((a) => [a.user.userId, a])
  );
  const resetSentAttempts = (cur: Record<string, Attempt>) =>
    Object.keys(cur).length === 0
      ? cur
      : carryOver(cur, (a) => a.state.status !== 'invited' && isInvitable(a.user.userId));

  const allLocalUsers = useMemo(
    () =>
      mergeUserDirectoryUsers(
        directUsers.map((userId) => ({ userId })),
        cache.users
      ),
    [directUsers, cache.users]
  );
  const knownUsersMap = new Map([...allLocalUsers, ...suggestions].map((u) => [u.userId, u]));
  const sortedBrowse = useMemo(() => {
    void rosterVersion;
    void memberLoads;
    const eligible = filterInviteUserCandidates(allLocalUsers, room, me);
    if (filter !== 'all') {
      return {
        direct: [] as ServerUserDirectoryUser[],
        directory: eligible
          .filter((u) => matchesFilter(u.userId, filter, me))
          .sort(compareBrowseUsers),
      };
    }
    const directSet = new Set(directUsers);
    return {
      direct: eligible.filter((u) => directSet.has(u.userId)).sort(compareBrowseUsers),
      directory: eligible.filter((u) => !directSet.has(u.userId)).sort(compareBrowseUsers),
    };
  }, [allLocalUsers, directUsers, filter, me, room, rosterVersion, memberLoads]);

  const isSearching = trimmedQuery.length > 0;
  const showSections = !isSearching && filter === 'all';
  const toTypedCandidate = (userId: string): Candidate => {
    const known = knownUsersMap.get(userId);
    return known
      ? { user: known, listed: true, section: 'search' }
      : { user: { userId }, listed: false, section: 'search' };
  };
  const takeCandidates = (
    users: readonly ServerUserDirectoryUser[],
    section: RowSection,
    limit: number
  ): Candidate[] =>
    users
      .filter((u) => !placed[u.userId])
      .slice(0, Math.max(0, limit))
      .map((user) => ({ user, listed: true, section }));

  let rowGroups: RowGroup[];
  let searchMatchCount = 0;
  if (showSections) {
    const budget = Math.max(0, BROWSE_LIMIT - activeAttempts.length);
    const directCands = takeCandidates(sortedBrowse.direct, 'direct', budget);
    const dirCands = takeCandidates(
      sortedBrowse.directory,
      'directory',
      budget - directCands.length
    );
    const bySection = (s: RowSection) => activeAttempts.filter((a) => a.section === s);
    rowGroups = [
      {
        key: 'pinned',
        ariaLabel: t('sharedUi.inviteUserPrompt.invite'),
        rows: mergeAttemptsIntoRows([], bySection('search'), knownUsersMap),
      },
      {
        key: 'direct',
        headingId: `${idPrefix}-direct`,
        heading: t('sharedUi.inviteUserPrompt.recentAndDirect'),
        rows: mergeAttemptsIntoRows(directCands, bySection('direct'), knownUsersMap),
      },
      {
        key: 'directory',
        headingId: `${idPrefix}-dir`,
        heading: t('sharedUi.inviteUserPrompt.directory'),
        rows: mergeAttemptsIntoRows(dirCands, bySection('directory'), knownUsersMap),
      },
    ].filter((g) => g.rows.length > 0);
  } else if (!isSearching) {
    const rows = mergeAttemptsIntoRows(
      takeCandidates(sortedBrowse.directory, 'directory', BROWSE_LIMIT - activeAttempts.length),
      activeAttempts,
      knownUsersMap
    );
    rowGroups = rows.length > 0 ? [{ key: 'browse', rows }] : [];
  } else {
    const matched: Candidate[] = suggestions.map((user) => ({
      user,
      listed: true,
      section: 'search',
    }));
    const includeTyped =
      isUserId(trimmedQuery) &&
      isInvitable(trimmedQuery) &&
      !matched.some((c) => c.user.userId === trimmedQuery);
    const searchCandidates = includeTyped ? [toTypedCandidate(trimmedQuery), ...matched] : matched;
    searchMatchCount = searchCandidates.length;
    const rows = mergeAttemptsIntoRows(searchCandidates, activeAttempts, knownUsersMap);
    rowGroups = rows.length > 0 ? [{ key: 'search', rows }] : [];
  }

  let nonInvitableHint: string | undefined;
  if (
    isSearching &&
    isUserId(trimmedQuery) &&
    !placed[trimmedQuery] &&
    !isInvitable(trimmedQuery)
  ) {
    const m = room.getMember(trimmedQuery)?.membership;
    if (trimmedQuery === me || m === KnownMembership.Join) {
      nonInvitableHint = t('sharedUi.inviteUserPrompt.alreadyInRoom');
    } else if (m === KnownMembership.Invite) {
      nonInvitableHint = t('sharedUi.inviteUserPrompt.alreadyInvited');
    } else if (m === KnownMembership.Ban) {
      nonInvitableHint = t('sharedUi.inviteUserPrompt.bannedFromRoom');
    }
  }
  const activeHint = nonInvitableHint ?? enterHint;
  const totalVisibleRows = rowGroups.reduce((sum, g) => sum + g.rows.length, 0);
  const isDirectoryLoading =
    !isSearching &&
    (cache.status === 'idle' || cache.status === 'loading') &&
    totalVisibleRows === 0;
  const directoryFailed = !isSearching && cache.status === 'error';

  const setAttemptState = (userId: string, state: AttemptState) =>
    setAttempts((cur) => {
      const prev = cur[userId];
      return prev ? { ...cur, [userId]: { ...prev, state } } : cur;
    });

  const inviteUser = async (
    candidate: Candidate,
    index: number,
    options?: { clearQuery?: boolean }
  ) => {
    const targetId = candidate.user.userId;
    if (inFlightRef.current.has(targetId)) return;
    const existing = placed[targetId];
    if (existing?.state.status === 'inviting' || existing?.state.status === 'invited') return;

    // Consume note immediately via ref so rapid invites never share it; preserve original note on Retry.
    let reason: string | undefined;
    if (existing?.state.status === 'failed') {
      reason = existing.reason;
    } else if (noteOpen) {
      reason = noteRef.current.trim() || undefined;
      if (reason !== undefined) {
        noteRef.current = '';
        setNote('');
      }
    }

    const targetOffer = grantModerator
      ? evaluateModeratorGrant(room, targetId, me, levels, creators)
      : undefined;
    const grantCeiling = targetOffer?.kind === 'grant' ? targetOffer.level : undefined;

    inFlightRef.current.add(targetId);
    setEnterHint(undefined);
    if (options?.clearQuery) {
      pinOrderRef.current -= 1;
      setQuery('');
      inputRef.current?.focus();
    }
    const pinnedIndex = pinOrderRef.current;
    setAttempts((cur) => ({
      ...(options?.clearQuery ? resetSentAttempts(cur) : cur),
      [targetId]: {
        ...candidate,
        section: options?.clearQuery ? 'search' : candidate.section,
        index: options?.clearQuery ? pinnedIndex : cur[targetId]?.index ?? index,
        reason,
        state: { status: 'inviting' },
      },
    }));

    try {
      await client.invite(room.roomId, targetId, reason);
    } catch (inviteError) {
      if (alive()) setAttemptState(targetId, { status: 'failed', error: inviteError });
      return;
    } finally {
      inFlightRef.current.delete(targetId);
    }

    if (alive()) {
      setAttemptState(targetId, { status: 'invited' });
      setAnnouncement(t('sharedUi.inviteUserPrompt.invited', { user: targetId }));
    }

    if (grantCeiling === undefined) return;
    const grantFailure = await grantRoomModeratorRights(client, room, targetId, grantCeiling);
    if (!grantFailure) return;
    const message = formatGrantFailure(grantFailure, targetId, grantCeiling, tags, t);
    if (alive()) setGrantError(message);
    else if (client.clientRunning !== false) store.set(detachedGrantErrorAtom, { message });
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
        const status = placed[trimmedQuery]?.state.status;
        if (
          isInvitable(trimmedQuery) &&
          !inFlightRef.current.has(trimmedQuery) &&
          status !== 'inviting' &&
          status !== 'invited'
        ) {
          event.preventDefault();
          void inviteUser(toTypedCandidate(trimmedQuery), 0, { clearQuery: true });
        }
      } else if (
        trimmedQuery.startsWith('@') ||
        (trimmedQuery.length > 0 && searchMatchCount === 0 && !isFetching)
      ) {
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
    if (evt.target.value.trim() !== trimmedQuery) setAttempts(resetSentAttempts);
  };

  const handleFilterChange = (next: InviteFilter) => {
    setEnterHint(undefined);
    if (next === filter) return;
    setFilter(next);
    setAttempts(resetSentAttempts);
  };

  const handleClearSearch = () => {
    setEnterHint(undefined);
    setQuery('');
    if (trimmedQuery) setAttempts(resetSentAttempts);
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
        <FocusTrap
          focusTrapOptions={{
            initialFocus: () => inputRef.current ?? false,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
            clickOutsideDeactivates: true,
          }}
        >
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
            variant="Surface"
            className={classNames(css.Dialog, phone && modalCss.PhoneModal)}
          >
            <Header size="500" className={css.TitleBar}>
              <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
                <Text as="h2" size="H4" id={TITLE_ID} truncate>
                  {title}
                </Text>
                <Text as="p" size="T200" priority="300" truncate>
                  {subtitle}
                </Text>
              </Box>
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
                <Box
                  role="group"
                  aria-label={t('sharedUi.inviteUserPrompt.filterLabel')}
                  alignItems="Center"
                  wrap="Wrap"
                  gap="200"
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
                </Box>
                {roomGrantLevel !== undefined && (
                  <Box direction="Column" gap="100">
                    <label className={css.ModeratorLabel}>
                      <Checkbox
                        variant="Primary"
                        size="200"
                        checked={grantModerator}
                        aria-describedby={moderatorHelpId}
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
                  </Box>
                )}
              </div>

              {grantError && (
                <div className={css.GrantAlert}>
                  <Text
                    as="span"
                    size="T200"
                    role="alert"
                    className={css.WrapText}
                    style={{ flexGrow: 1 }}
                  >
                    {grantError}
                  </Text>
                  <IconButton
                    type="button"
                    size="300"
                    radii="300"
                    aria-label={t('mindroomUi.notices.dismiss')}
                    onClick={() => setGrantError(undefined)}
                  >
                    <Icon size="100" src={Icons.Cross} />
                  </IconButton>
                </div>
              )}

              {/* Arrow keys move focus between row actions and the search field. */}
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div ref={listRef} className={css.ListArea} onKeyDown={handleListKeyDown}>
                <div role="status">
                  {activeHint && (
                    <Text as="p" size="T200" priority="300" className={css.CenteredHint}>
                      {activeHint}
                    </Text>
                  )}
                </div>

                {directoryFailed && (
                  <Box direction="Column" alignItems="Center" gap="200" className={css.EmptyState}>
                    <Text as="p" size="T200" priority="300" role="alert">
                      {t('sharedUi.invites.actionFailed')}
                    </Text>
                    <Button
                      type="button"
                      size="300"
                      variant="Secondary"
                      fill="Soft"
                      radii="300"
                      onClick={() => void cache.refresh()}
                    >
                      <Text as="span" size="B300">
                        {t('sharedUi.roomCard.retry')}
                      </Text>
                    </Button>
                  </Box>
                )}

                {rowGroups.map((group) => (
                  <div key={group.key}>
                    {group.heading && (
                      <Text
                        as="h3"
                        id={group.headingId}
                        size="L400"
                        priority="300"
                        className={css.SectionHeader}
                      >
                        {group.heading}
                      </Text>
                    )}
                    {/* Keep list semantics in Safari VoiceOver when list-style is none. */}
                    {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
                    <ul
                      role="list"
                      className={css.List}
                      aria-label={group.ariaLabel}
                      aria-labelledby={group.headingId}
                    >
                      {group.rows.map((row, index) => (
                        <InviteDirectoryRow
                          key={row.user.userId}
                          row={row}
                          viewerId={me}
                          authenticatedMedia={authenticatedMedia}
                          onInvite={() => void inviteUser(row, index)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}

                {(isDirectoryLoading || (isSearching && isFetching)) && (
                  <Box
                    alignItems="Center"
                    justifyContent="Center"
                    gap="200"
                    className={css.CenteredHint}
                  >
                    <Spinner variant="Secondary" size="100" />
                    {totalVisibleRows === 0 && (
                      <Text as="span" size="T200" priority="300">
                        {t('sharedUi.inviteUserAutocomplete.searching')}
                      </Text>
                    )}
                  </Box>
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
                    onChange={(evt: ChangeEvent<HTMLInputElement>) => {
                      noteRef.current = evt.target.value;
                      setNote(evt.target.value);
                    }}
                    placeholder={t('sharedUi.inviteUserPrompt.notePlaceholder')}
                    aria-label={t('sharedUi.inviteUserPrompt.notePlaceholder')}
                    autoComplete="off"
                  />
                )}
              </div>
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
