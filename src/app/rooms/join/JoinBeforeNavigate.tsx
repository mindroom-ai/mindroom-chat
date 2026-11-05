import { useEffect, useState } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import {
  ClientEvent,
  JoinRule,
  type Room,
  RoomEvent,
  RoomType,
  type RoomSummary,
} from 'matrix-js-sdk';
import { Page, PageHeader } from '../../ui/page/Page';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { RoomSummaryLoader } from '../RoomSummaryLoader';
import { RoomAccessControl } from '../RoomAccessControl';
import * as roomCardCss from '../RoomCard.css';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { nameInitials } from '../../lib/common';
import { Membership } from '../../matrix/types/room';
import { getHomePath } from '../../routes/pathUtils';
import { declineInvite } from '../../notifications/inbox/declineInvite';
import { useAlive } from '../../lib/hooks/useAlive';

type JoinBeforeNavigateProps = {
  roomIdOrAlias: string;
  eventId?: string;
  /** The thread the link opens, kept once the room is joined. */
  threadId?: string;
  viaServers?: string[];
};

type SummaryData = Partial<RoomSummary> & {
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

/** Who invited this account, above the way in, when the room's invite is pending. */
function InvitedBy({ roomId }: { roomId: string }) {
  const client = useMatrixClient();
  const { room, membership } = useMyMembership(roomId);
  if (!room || membership !== Membership.Invite) return null;
  const sender = room.getMember(client.getSafeUserId())?.events.member?.getSender();
  const senderName = (sender && room.getMember(sender)?.name) || sender;
  if (!senderName) return null;
  return (
    <Text size="T200">
      <Trans
        i18nKey="sharedUi.invites.from"
        values={{ sender: senderName }}
        components={{ b: <b title={sender} /> }}
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

/** Who removed this account from the room, and why, from its own member event. */
function RemovalNote({ room }: { room: Room }) {
  const own = room.getMember(room.myUserId);
  const event = own?.events.member;
  const sender = event?.getSender();
  if (!own || !event || !sender || sender === own.userId) return null;
  const reason = event.getContent().reason;
  const by = own.membership === Membership.Ban ? 'bannedBy' : 'kickedBy';
  const bold = { b: <b /> };
  return (
    <Box direction="Column" gap="100">
      <Text size="T200">
        <Trans
          i18nKey={`sharedUi.userModeration.${by}` as const}
          values={{ name: room.getMember(sender)?.name ?? sender }}
          components={bold}
        />
      </Text>
      {typeof reason === 'string' && reason.trim() && (
        <Text size="T200">
          <Trans i18nKey="sharedUi.userModeration.reason" values={{ reason }} components={bold} />
        </Text>
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
          {room.name}
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
  const name = summary.name || summary.canonical_alias || roomIdOrAlias;
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
          {summary.topic}
        </Text>
      )}
      <InvitedBy roomId={roomId} />
      {blocked ? (
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
            </>
          )}
        </RoomAccessControl>
      )}
      <KnownRoomActions roomId={roomId} />
    </Box>
  );
}

/** The page header: a link icon and the room alias or ID the link was opened with. */
function LinkHeader({ target }: { target: string }) {
  return (
    <PageHeader balance>
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
        <Icon size="200" src={Icons.Link} />
        <Text as="h1" size="H4" truncate>
          {target}
        </Text>
      </Box>
    </PageHeader>
  );
}

/**
 * Shown for a room link the user has not joined: the room's summary and the
 * way in its join rule allows (join, request to join, or none), before the
 * room itself opens.
 */
export function JoinBeforeNavigate(props: JoinBeforeNavigateProps) {
  const { roomIdOrAlias, viaServers } = props;
  const { t } = useTranslation();

  return (
    <Page>
      <LinkHeader target={roomIdOrAlias} />
      <Box
        grow="Yes"
        direction="Column"
        justifyContent="Center"
        style={{ padding: config.space.S400, overflowY: 'auto' }}
      >
        <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias} viaServers={viaServers}>
          {(state, retry, resolvedViaServers) => {
            if (state.status === AsyncStatus.Success) {
              return (
                <SummaryCard
                  {...props}
                  summary={state.data as SummaryData}
                  viaServers={resolvedViaServers ?? viaServers}
                />
              );
            }
            if (state.status === AsyncStatus.Error) {
              return <UnreachableRoom roomIdOrAlias={roomIdOrAlias} retry={retry} />;
            }
            return (
              <Box direction="Column" alignItems="Center" gap="300">
                <Spinner variant="Secondary" size="400" />
                <Text size="T300">{t('sharedUi.roomCard.checkingAccess')}</Text>
              </Box>
            );
          }}
        </RoomSummaryLoader>
      </Box>
    </Page>
  );
}
