import React, { useEffect } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { JoinRule, RoomType, type RoomSummary } from 'matrix-js-sdk';
import { Page, PageHeader } from '../../components/page';
import { RoomAvatar } from '../../components/room-avatar';
import { RoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { RoomAccessControl } from '../../components/room-access';
import * as roomCardCss from '../../components/room-card/style.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { Membership } from '../../../types/matrix/room';

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
            roomId={roomId}
            alt={name}
            src={avatarUrl}
            renderFallback={() => <Icon size="300" src={Icons.Hash} />}
          />
        </Avatar>
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="H4" truncate>
            {name}
          </Text>
          {summary.num_joined_members !== undefined && (
            <Text size="T200" priority="300">
              {t('sharedUi.roomCard.members', { count: summary.num_joined_members })}
            </Text>
          )}
        </Box>
      </Box>
      {summary.topic && (
        <Text className={roomCardCss.RoomCardTopic} size="T300">
          {summary.topic}
        </Text>
      )}
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
    </Box>
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
      <PageHeader balance>
        <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
          <Icon size="200" src={Icons.Link} />
          <Text as="h1" size="H4" truncate>
            {roomIdOrAlias}
          </Text>
        </Box>
      </PageHeader>
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
              return (
                <Box direction="Column" alignItems="Center" gap="300">
                  <Button variant="Secondary" fill="Soft" radii="300" size="300" onClick={retry}>
                    <Text size="B300">{t('sharedUi.roomCard.retryRoomInfo')}</Text>
                  </Button>
                </Box>
              );
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
