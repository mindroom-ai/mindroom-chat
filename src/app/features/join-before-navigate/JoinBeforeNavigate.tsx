import React, { useEffect } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { JoinRule, type RoomSummary } from 'matrix-js-sdk';
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
  viaServers?: string[];
};

type SummaryData = Partial<RoomSummary> & {
  room_id: string;
  canonical_alias?: string;
  join_rule?: string;
  membership?: string;
};

function JoinedNavigation({ roomId, eventId }: { roomId: string; eventId?: string }) {
  const { navigateRoom } = useRoomNavigate();
  useEffect(() => {
    navigateRoom(roomId, eventId, { replace: true });
  }, [navigateRoom, roomId, eventId]);
  return null;
}

function SummaryCard({



  eventId,
}: {
  summary: SummaryData;







  const roomId = summary.room_id;
  const name = summary.name || summary.canonical_alias || roomIdOrAlias;
  let avatarUrl: string | undefined;
  try {
    avatarUrl = summary.avatar_url
      ? mxcUrlToHttp(mx, summary.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
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



            renderFallback={() => <Icon size="300" src={Icons.Hash} />}
          />
        </Avatar>
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="H4" truncate>
            {name}
          </Text>
          {summary.num_joined_members !== undefined && (
            <Text size="T200" priority="300">
              {t('featureUi.joinBeforeNavigate.members', { count: summary.num_joined_members })}
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
          {t('featureUi.joinBeforeNavigate.accessUnavailable')}
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
              {access.succeeded && !knock && <JoinedNavigation roomId={roomId} eventId={eventId} />}
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
                      ? t('featureUi.joinBeforeNavigate.requested')
                      : t('featureUi.joinBeforeNavigate.requestToJoin')
                    : t('featureUi.joinBeforeNavigate.join')}
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





















      >
        <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias} viaServers={viaServers}>
          {(state, retry, resolvedViaServers) => {
            if (state.status === AsyncStatus.Success) {
              return (
                <SummaryCard
                  summary={state.data as SummaryData}
                  roomIdOrAlias={roomIdOrAlias}
                  viaServers={resolvedViaServers ?? viaServers}
                  eventId={eventId}
                />
              );
            }
            if (state.status === AsyncStatus.Error) {
              return (
                <Box direction="Column" alignItems="Center" gap="300">
                  <Text size="T300">{t('featureUi.joinBeforeNavigate.summaryFailed')}</Text>
                  <Button variant="Secondary" fill="Soft" radii="300" size="300" onClick={retry}>
                    <Text size="B300">{t('featureUi.joinBeforeNavigate.retry')}</Text>
                  </Button>
                </Box>
              );
            }
            return (
              <Box direction="Column" alignItems="Center" gap="300">
                <Spinner variant="Secondary" size="400" />
                <Text size="T300">{t('featureUi.joinBeforeNavigate.checkingAccess')}</Text>
              </Box>
            );
          }}
        </RoomSummaryLoader>
      </Box>
    </Page>
  );
}
