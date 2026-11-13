import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ClientEvent,
  EventType,
  JoinRule,
  Method,
  type Room,
  RoomEvent,
  RoomType,
  type RoomSummary,
  SyncState,
} from 'matrix-js-sdk';
import { Page, PageHeader } from '../../ui/page/Page';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { RoomSummaryLoader, type RoomSummaryState } from '../RoomSummaryLoader';
import { useLocalRoomSummary } from '../useLocalRoomSummary';
import { RoomAccessControl } from '../RoomAccessControl';
import { JoinFailure } from '../JoinFailure';
import * as roomCardCss from '../RoomCard.css';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSyncState } from '../../matrix/hooks/useSyncState';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { nameInitials } from '../../lib/common';
import { Membership } from '../../matrix/types/room';
import { getMemberDisplayName } from '../../matrix/room';
import { getDirectPath, getHomePath, getSpacePath } from '../../routes/pathUtils';
import { previousHistoryOrigin, showsRoom } from '../../routes/historyStack';
import { useDirectSelected } from '../../routes/useDirectSelected';
import { useSelectedSpace } from '../../navigation/useSelectedSpace';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { getCanonicalAliasOrRoomId, isRoomAlias } from '../../matrix/matrix';
import { declineInvite } from '../../notifications/inbox/declineInvite';
import { useAlive } from '../../lib/hooks/useAlive';
import { isRecord } from '../../lib/isRecord';
import { revealDirectionControls } from '../../ui/directional';

type JoinBeforeNavigateProps = {
  roomIdOrAlias: string;
  eventId?: string;
  /** The thread the link opens, kept once the room is joined. */
  threadId?: string;
  viaServers?: string[];
};

type SummaryData = Omit<Partial<RoomSummary>, 'join_rule'> & {
  room_id: string;
  canonical_alias?: string;
  join_rule?: string;
  membership?: string;
};

/** Opens what was joined: a space at its space path, a room at its room path and thread. */
function JoinedNavigation({
  roomId,
  eventId,
  threadId,
  isSpace,
}: {
  roomId: string;
  eventId?: string;
  threadId?: string;
  isSpace: boolean;
}) {
  const { navigateRoom, navigateRoomThreadDirect, navigateSpace } = useRoomNavigate();
  useEffect(() => {
    if (isSpace) navigateSpace(roomId, { replace: true });
    else if (threadId) navigateRoomThreadDirect(roomId, threadId, eventId, { replace: true });
    else navigateRoom(roomId, eventId, { replace: true });
  }, [navigateRoom, navigateRoomThreadDirect, navigateSpace, roomId, eventId, threadId, isSpace]);
  return null;
}

/** This account's membership of a room it knows, following changes from sync. */
const useMyMembership = (roomId: string): { room: Room | null; membership?: string } => {
  const client = useMatrixClient();
  const [, setVersion] = useState(0);
  useEffect(() => {
    const refresh = (room: Room) => {
      if (room.roomId === roomId) setVersion((version) => version + 1);
    };
    const dropped = (droppedId: string) => {
      if (droppedId === roomId) setVersion((version) => version + 1);
    };
    client.on(RoomEvent.MyMembership, refresh);
    client.on(ClientEvent.DeleteRoom, dropped);
    return () => {
      client.removeListener(RoomEvent.MyMembership, refresh);
      client.removeListener(ClientEvent.DeleteRoom, dropped);
    };
  }, [client, roomId]);
  const room = client.getRoom(roomId);
  return { room, membership: room?.getMyMembership() };
};

// Escaped, a revealed `<U+202E>` and a name's `<` stay text instead of reading as tags.
const ESCAPED = { interpolation: { escapeValue: true } };

/** Who invited this account, above the way in, when the room's invite is pending. */
function InvitedBy({ roomId }: { roomId: string }) {
  const client = useMatrixClient();
  const { room, membership } = useMyMembership(roomId);
  if (!room || membership !== Membership.Invite) return null;
  const sender = room.getMember(client.getSafeUserId())?.events.member?.getSender();
  const senderName = (sender && getMemberDisplayName(room, sender)) || sender;
  if (!senderName) return null;
  return (
    <Text size="T200">
      <Trans
        i18nKey="sharedUi.invites.from"
        values={{ sender: senderName }}
        components={{ b: <b title={sender} /> }}
        tOptions={ESCAPED}
        shouldUnescape
      />
    </Text>
  );
}

/**
 * Where this account stands with a room it knows but has not joined: an invite it may turn down,
 * or a room it left or was removed from, which it may forget. Forgetting leads home, since the
 * room is gone from the account.
 */
function KnownRoomActions({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { navigatePath } = useRoomNavigate();
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { membership } = useMyMembership(roomId);

  const run = (request: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setFailed(false);
    request()
      .then(() => alive() && after?.())
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setBusy(false));
  };

  let action: { label: string; critical: boolean; onClick: () => void } | undefined;
  if (membership === Membership.Invite) {
    action = {
      label: t('sharedUi.invites.decline'),
      critical: true,
      // A declined invite leaves nothing to show; the room is forgotten with it.
      onClick: () =>
        run(
          () => declineInvite(client, roomId),
          () => navigatePath(getHomePath())
        ),
    };
  } else if (membership === Membership.Leave || membership === Membership.Ban) {
    action = {
      label: t('sharedUi.roomCard.forget'),
      critical: false,
      onClick: () =>
        run(
          () => client.forget(roomId),
          () => navigatePath(getHomePath())
        ),
    };
  }
  if (!action) return null;

  return (
    <Box direction="Column" gap="200">
      <Button
        className={roomCardCss.ActionButton}
        variant={action.critical ? 'Critical' : 'Secondary'}
        fill="Soft"
        radii="300"
        size="400"
        disabled={busy}
        onClick={action.onClick}
      >
        <Text size="B400">{action.label}</Text>
      </Button>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('sharedUi.invites.actionFailed')}
        </Text>
      )}
    </Box>
  );
}

/** Who removed this account from the room (`name`) and why, when the removal says. */
function RemovalLines({
  by,
  name,
  reason,
}: {
  by: 'bannedBy' | 'kickedBy';
  name?: string;
  reason: unknown;
}) {
  const bold = { b: <b /> };
  const shownReason =
    typeof reason === 'string' && reason.trim() !== '' ? revealDirectionControls(reason) : '';
  if (!name && !shownReason) return null;
  return (
    <Box direction="Column" gap="100">
      {name && (
        <Text size="T200">
          <Trans
            i18nKey={`sharedUi.userModeration.${by}` as const}
            values={{ name }}
            components={bold}
            tOptions={ESCAPED}
            shouldUnescape
          />
        </Text>
      )}
      {shownReason && (
        <Text size="T200">
          <Trans
            i18nKey="sharedUi.userModeration.reason"
            values={{ reason: shownReason }}
            components={bold}
            tOptions={ESCAPED}
            shouldUnescape
          />
        </Text>
      )}
    </Box>
  );
}

/** Who removed this account from the room, and why, from its own member event. */
function RemovalNote({ room }: { room: Room }) {
  const own = room.getMember(room.myUserId);
  const event = own?.events.member;
  const sender = event?.getSender();
  if (!own || !event || !sender || sender === own.userId) return null;
  return (
    <RemovalLines
      by={own.membership === Membership.Ban ? 'bannedBy' : 'kickedBy'}
      name={getMemberDisplayName(room, sender) ?? sender}
      reason={event.getContent().reason}
    />
  );
}

/** A ban as the account's own member event in the room tells it: who banned it, and why. */
type Ban = { sender?: string; reason?: unknown };

/**
 * The account's member event in a room it is banned from, as the server keeps it: a banned former
 * member may read the room's state as of its ban. The full event names who banned it (servers
 * that ignore `format=event` answer the content alone). Undefined while it loads or when the
 * server will not say.
 */
const useServerBan = (roomId: string, skip: boolean): Ban | undefined => {
  const client = useMatrixClient();
  const [ban, setBan] = useState<Ban>();
  useEffect(() => {
    if (skip) return undefined;
    let current = true;
    const path = `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      EventType.RoomMember
    )}/${encodeURIComponent(client.getSafeUserId())}`;
    client.http
      .authedRequest<unknown>(Method.Get, path, { format: 'event' })
      .then((answer) => {
        if (!current || !isRecord(answer)) return;
        const content = isRecord(answer.content) ? answer.content : answer;
        if (content.membership !== Membership.Ban) return;
        setBan({
          sender: typeof answer.sender === 'string' ? answer.sender : undefined,
          reason: content.reason,
        });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, roomId, skip]);
  return ban;
};

/**
 * Why there is no way in for an account banned from the room: it says so, and who banned it and
 * why, from the room this device kept, else from the server.
 */
function BanNote({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { room } = useMyMembership(roomId);
  const kept = room?.getMember(client.getSafeUserId())?.membership === Membership.Ban;
  const fromServer = useServerBan(roomId, kept);
  return (
    <Box direction="Column" gap="200">
      <Text size="T300" style={{ color: color.Critical.Main }}>
        {t('sharedUi.roomCard.banned')}
      </Text>
      {room && kept ? (
        <RemovalNote room={room} />
      ) : (
        fromServer && (
          <RemovalLines by="bannedBy" name={fromServer.sender} reason={fromServer.reason} />
        )
      )}
    </Box>
  );
}

/**
 * A room whose summary the server would not give: one this account left or was removed from
 * shows its name, who removed it and why, and Forget (asking again would fail the same way);
 * anything else offers to try again.
 */
function UnreachableRoom({ roomIdOrAlias, retry }: { roomIdOrAlias: string; retry: () => void }) {
  const { t } = useTranslation();
  const { room, membership } = useMyMembership(roomIdOrAlias);
  const retryButton = (
    <Button variant="Secondary" fill="Soft" radii="300" size="300" onClick={retry}>
      <Text size="B300">{t('sharedUi.roomCard.retryRoomInfo')}</Text>
    </Button>
  );
  const left = membership === Membership.Leave || membership === Membership.Ban;
  if (!room || !left) {
    return (
      <Box direction="Column" alignItems="Center" gap="300">
        {retryButton}
      </Box>
    );
  }
  return (
    <Box
      className={roomCardCss.RoomCardBase}
      direction="Column"
      gap="300"
      style={{ maxWidth: '28rem', margin: '0 auto' }}
    >
      <Box gap="300" alignItems="Center">
        <Avatar size="500" radii="400">
          <RoomAvatar
            roomId={room.roomId}
            alt={room.name}
            renderFallback={() => <Icon size="300" src={Icons.Hash} />}
          />
        </Avatar>
        <Text size="H4" truncate>
          {revealDirectionControls(room.name)}
        </Text>
      </Box>
      <RemovalNote room={room} />
      <KnownRoomActions roomId={room.roomId} />
    </Box>
  );
}

/** What the link points at, plus the summary the server gave for it. */
type SummaryCardProps = JoinBeforeNavigateProps & { summary: SummaryData };

function SummaryCard({ summary, roomIdOrAlias, viaServers, eventId, threadId }: SummaryCardProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const roomId = summary.room_id;
  // Direction controls in the name and topic show as code points, so they cannot reorder them.
  const name = revealDirectionControls(summary.name || summary.canonical_alias || roomIdOrAlias);
  let avatarUrl: string | undefined;
  try {
    avatarUrl = summary.avatar_url
      ? mxcUrlToHttp(client, summary.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
      : undefined;
  } catch {
    // A client without a homeserver URL yet shows the fallback icon.
    avatarUrl = undefined;
  }
  // A summary without a join rule comes from a public room, as the spec's default says.
  const joinRule = (summary.join_rule as JoinRule | undefined) ?? JoinRule.Public;
  const invited = summary.membership === Membership.Invite;
  const blocked = !invited && (joinRule === JoinRule.Invite || joinRule === JoinRule.Private);
  const knock =
    !invited && (joinRule === JoinRule.Knock || joinRule === ('knock_restricted' as JoinRule));
  // A space reads as one: its initials on a rounded square and "Space" beside the member count.
  const isSpace = summary.room_type === RoomType.Space;
  const { membership: keptMembership } = useMyMembership(roomId);
  const banned = summary.membership === Membership.Ban || keptMembership === Membership.Ban;

  return (
    <Box
      className={roomCardCss.RoomCardBase}
      direction="Column"
      gap="300"
      style={{ maxWidth: '28rem', margin: '0 auto' }}
    >
      <Box gap="300" alignItems="Center">
        <Avatar size="500" radii={isSpace ? '500' : '400'}>
          <RoomAvatar
            roomId={roomId}
            alt={name}
            src={avatarUrl}
            renderFallback={() =>
              isSpace ? (
                <Text size="H3">{nameInitials(name)}</Text>
              ) : (
                <Icon size="300" src={Icons.Hash} />
              )
            }
          />
        </Avatar>
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="H4" truncate>
            {name}
          </Text>
          {(isSpace || summary.num_joined_members !== undefined) && (
            <Text size="T200" priority="300">
              {[
                isSpace ? t('sharedUi.roomCard.space') : undefined,
                summary.num_joined_members !== undefined
                  ? t('sharedUi.roomCard.members', { count: summary.num_joined_members })
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </Box>
      </Box>
      {summary.topic && (
        <Text className={roomCardCss.RoomCardTopic} size="T300">
          {revealDirectionControls(summary.topic)}
        </Text>
      )}
      <InvitedBy roomId={roomId} />
      {banned ? (
        <BanNote roomId={roomId} />
      ) : blocked ? (
        <Text size="T300" style={{ color: color.Critical.Main }}>
          {t('sharedUi.roomCard.accessUnavailable')}
        </Text>
      ) : (
        <RoomAccessControl
          roomIdOrAlias={roomId}
          roomId={roomId}
          roomName={name}
          joinRule={invited ? JoinRule.Invite : joinRule}
          membership={summary.membership as Membership | undefined}
          viaServers={viaServers}
        >
          {(access) => (
            <>
              {access.succeeded && !knock && (
                <JoinedNavigation
                  roomId={roomId}
                  eventId={eventId}
                  threadId={threadId}
                  isSpace={summary.room_type === RoomType.Space}
                />
              )}
              <Button
                className={roomCardCss.ActionButton}
                variant={knock ? 'Secondary' : 'Primary'}
                fill="Solid"
                radii="300"
                size="400"
                disabled={knock ? access.requested : access.succeeded}
                onClick={access.activate}
              >
                <Text size="B400" truncate>
                  {knock
                    ? access.requested
                      ? t('sharedUi.roomCard.requestSent')
                      : t('sharedUi.roomCard.requestToJoin')
                    : t('sharedUi.roomCard.join')}
                </Text>
              </Button>
              {access.joinError !== undefined && <JoinFailure error={access.joinError} />}
            </>
          )}
        </RoomAccessControl>
      )}
      <KnownRoomActions roomId={roomId} />
    </Box>
  );
}

/**
 * How the page header names the room: by the address the link used, else the room's own
 * address, else its name (from the summary, or the client's own copy of an invite), else the room
 * ID the link used. The summary brings the address and name once it loads; a link by room ID
 * often reaches here as one because an alias route is swapped for its room ID before the page
 * shows.
 */
const headerTarget = (roomIdOrAlias: string, summary?: SummaryData, knownName?: string): string =>
  (isRoomAlias(roomIdOrAlias) ? roomIdOrAlias : undefined) ||
  summary?.canonical_alias ||
  summary?.name ||
  knownName ||
  roomIdOrAlias;

/**
 * A phone's way off the page, where it fills the screen: back to the page it was opened from,
 * passing over the room's own entries; opened from outside the app, to the list its route sits in
 * (the space's, Direct's or Home's), which takes the page's place in history.
 */
function PageBack({ addresses }: { addresses: string[] }) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const space = useSelectedSpace();
  const direct = useDirectSelected();
  const leave = () => {
    const origin = previousHistoryOrigin((page) => !showsRoom(page, addresses));
    if (origin) {
      navigate(-origin.steps);
      return;
    }
    let list = getHomePath();
    // The page of a space that is not joined sits at the space's own path.
    if (space && !addresses.includes(space)) {
      list = getSpacePath(getCanonicalAliasOrRoomId(mx, space));
    } else if (direct) list = getDirectPath();
    navigate(list, { replace: true });
  };
  return <PhoneBackButton onBack={leave} />;
}

/**
 * The page header: a link icon (a back button on phones) and how the room is named
 * (`headerTarget`).
 */
function LinkHeader({ target, addresses }: { target: string; addresses: string[] }) {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  return (
    <PageHeader balance>
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
        {phone ? <PageBack addresses={addresses} /> : <Icon size="200" src={Icons.Link} />}
        <Text as="h1" size="H4" truncate>
          {revealDirectionControls(target)}
        </Text>
      </Box>
    </PageHeader>
  );
}

/** The name the client knows for a room it was invited to or removed from, from its own state. */
const knownRoomName = (room: Room | null): string | undefined =>
  room?.name && room.name !== room.roomId ? room.name : undefined;

/**
 * An invite the server's summary has not described (yet): the card built from the invite's own
 * state, which the client keeps across offline starts, so its name, inviter and buttons show while
 * the homeserver cannot be reached.
 */
function LocalInviteCard({ room, ...props }: JoinBeforeNavigateProps & { room: Room }) {
  const local = useLocalRoomSummary(room);
  const summary: SummaryData = {
    room_id: room.roomId,
    name: knownRoomName(room),
    topic: local.topic,
    avatar_url: local.avatarUrl,
    canonical_alias: local.canonicalAlias,
    join_rule: local.joinRule,
    room_type: local.roomType,
    membership: Membership.Invite,
  };
  return <SummaryCard {...props} summary={summary} />;
}

type JoinPageProps = JoinBeforeNavigateProps & {
  state: RoomSummaryState;
  retry: () => void;
  /** The room ID, once an alias resolved to one. */
  roomId?: string;
};

function JoinPage({ state, retry, roomId, ...props }: JoinPageProps) {
  const { roomIdOrAlias } = props;
  const { t } = useTranslation();
  const mx = useMatrixClient();
  // A summary that failed while the homeserver was out of reach is asked again once sync is back.
  const failed = state.status === AsyncStatus.Error;
  useSyncState(
    mx,
    useCallback(
      (syncState: SyncState, previous: SyncState | null) => {
        const reconnected =
          syncState === SyncState.Prepared ||
          (syncState === SyncState.Syncing && previous !== SyncState.Syncing);
        if (reconnected && failed) retry();
      },
      [failed, retry]
    )
  );
  const summary = state.status === AsyncStatus.Success ? (state.data as SummaryData) : undefined;
  const { room, membership } = useMyMembership(summary?.room_id ?? roomId ?? roomIdOrAlias);

  let body: ReactNode;
  if (summary) {
    body = <SummaryCard {...props} summary={summary} />;
  } else if (room && membership === Membership.Invite) {
    body = <LocalInviteCard {...props} room={room} />;
  } else if (state.status === AsyncStatus.Error) {
    body = <UnreachableRoom roomIdOrAlias={room?.roomId ?? roomIdOrAlias} retry={retry} />;
  } else {
    body = (
      <Box direction="Column" alignItems="Center" gap="300">
        <Spinner variant="Secondary" size="400" />
        <Text size="T300">{t('sharedUi.roomCard.checkingAccess')}</Text>
      </Box>
    );
  }

  return (
    <Page>
      <LinkHeader
        target={headerTarget(roomIdOrAlias, summary, knownRoomName(room))}
        addresses={[roomIdOrAlias, summary?.room_id ?? roomId ?? room?.roomId].filter(
          (address): address is string => !!address
        )}
      />
      <Box
        grow="Yes"
        direction="Column"
        justifyContent="Center"
        style={{ padding: config.space.S400, overflowY: 'auto' }}
      >
        {body}
      </Box>
    </Page>
  );
}

/**
 * Shown for a room link the user has not joined: the room's summary and the
 * way in its join rule allows (join, request to join, or none), before the
 * room itself opens. An invite shows from the client's own copy until the
 * server's summary arrives.
 */
export function JoinBeforeNavigate(props: JoinBeforeNavigateProps) {
  const { roomIdOrAlias, viaServers } = props;

  return (
    <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias} viaServers={viaServers}>
      {(state, retry, resolvedViaServers, roomId) => (
        <JoinPage
          {...props}
          viaServers={resolvedViaServers ?? viaServers}
          state={state}
          retry={retry}
          roomId={roomId}
        />
      )}
    </RoomSummaryLoader>
  );
}
